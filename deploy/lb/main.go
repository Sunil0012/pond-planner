// PondSite Load Balancer — written in Go
// Listens on :3000, round-robins to 4 Node.js backends (:3001-:3004)
// with active health-checking, automatic failover, and static SPA serving.
//
// Build:  go build -o pondlb main.go
// Run:    ./pondlb
// Or with PM2: pm2 start pondlb --name pondlb-go

package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"time"
)

// ─────────────────────────────────────────────────────────────────────────────
// Backend pool
// ─────────────────────────────────────────────────────────────────────────────

type Backend struct {
	URL          *url.URL
	alive        atomic.Bool
	reverseProxy *httputil.ReverseProxy
	mu           sync.Mutex
	failCount    int
}

func (b *Backend) IsAlive() bool { return b.alive.Load() }
func (b *Backend) SetAlive(v bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.alive.Store(v)
	if v {
		b.failCount = 0
	} else {
		b.failCount++
	}
}

// ServerPool holds all backends and the round-robin counter.
type ServerPool struct {
	backends []*Backend
	current  atomic.Uint64
}

// NextBackend picks the next alive backend using round-robin.
func (sp *ServerPool) NextBackend() *Backend {
	n := uint64(len(sp.backends))
	if n == 0 {
		return nil
	}
	for range n {
		idx := sp.current.Add(1) % n
		b := sp.backends[idx]
		if b.IsAlive() {
			return b
		}
	}
	return nil // all backends down
}

// HealthCheck pings every backend's /api/health endpoint.
func (sp *ServerPool) HealthCheck(ctx context.Context) {
	client := &http.Client{Timeout: 5 * time.Second}
	for _, b := range sp.backends {
		target := b.URL.String() + "/api/health"
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
		if err != nil {
			b.SetAlive(false)
			continue
		}
		resp, err := client.Do(req)
		if err != nil || resp.StatusCode >= 500 {
			if b.IsAlive() {
				log.Printf("[lb] backend %s is DOWN", b.URL)
			}
			b.SetAlive(false)
		} else {
			if !b.IsAlive() {
				log.Printf("[lb] backend %s is UP", b.URL)
			}
			b.SetAlive(true)
			resp.Body.Close()
		}
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

func lbHandler(pool *ServerPool, distDir string) http.Handler {
	// Static SPA file server (serves dist/ for non-API routes)
	spaFs := http.FileServer(http.Dir(distDir))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// ── Load-balancer health endpoint ──────────────────────────────────
		if r.URL.Path == "/lb-health" {
			alive := 0
			for _, b := range pool.backends {
				if b.IsAlive() {
					alive++
				}
			}
			w.Header().Set("Content-Type", "application/json")
			fmt.Fprintf(w, `{"lb":"ok","backends":%d,"alive":%d}`, len(pool.backends), alive)
			return
		}

		// ── API routes → reverse-proxy to a backend ────────────────────────
		if len(r.URL.Path) >= 4 && r.URL.Path[:4] == "/api" {
			backend := pool.NextBackend()
			if backend == nil {
				http.Error(w, `{"ok":false,"error":"All backends are currently unavailable. Try again shortly."}`, http.StatusServiceUnavailable)
				return
			}
			// Retry once on failure
			backend.reverseProxy.ErrorHandler = func(rw http.ResponseWriter, req *http.Request, err error) {
				log.Printf("[lb] proxy error to %s: %v — trying next backend", backend.URL, err)
				backend.SetAlive(false)
				next := pool.NextBackend()
				if next == nil {
					http.Error(rw, `{"ok":false,"error":"Backend unavailable"}`, http.StatusBadGateway)
					return
				}
				next.reverseProxy.ServeHTTP(rw, req)
			}
			backend.reverseProxy.ServeHTTP(w, r)
			return
		}

		// ── Static SPA — serve from dist/ ─────────────────────────────────
		// If the file doesn't exist, fall through to index.html (SPA routing)
		path := filepath.Join(distDir, filepath.Clean("/"+r.URL.Path))
		if _, err := os.Stat(path); os.IsNotExist(err) {
			http.ServeFile(w, r, filepath.Join(distDir, "index.html"))
			return
		}
		spaFs.ServeHTTP(w, r)
	})
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

func main() {
	port := flag.String("port", "3000", "Port to listen on")
	distDir := flag.String("dist", "./dist", "Path to built SPA dist/ directory")
	flag.Parse()

	backendPorts := []string{"3001", "3002", "3003", "3004"}

	pool := &ServerPool{}
	for _, p := range backendPorts {
		rawURL := fmt.Sprintf("http://127.0.0.1:%s", p)
		u, err := url.Parse(rawURL)
		if err != nil {
			log.Fatalf("invalid backend URL %s: %v", rawURL, err)
		}
		proxy := httputil.NewSingleHostReverseProxy(u)
		// Increase idle conns for throughput
		proxy.Transport = &http.Transport{
			MaxIdleConns:        100,
			MaxIdleConnsPerHost: 20,
			IdleConnTimeout:     90 * time.Second,
		}
		b := &Backend{URL: u, reverseProxy: proxy}
		b.SetAlive(true) // optimistic start; health-check corrects within 5s
		pool.backends = append(pool.backends, b)
		log.Printf("[lb] registered backend %s", rawURL)
	}

	// Run health checks every 10 seconds
	ctx := context.Background()
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		pool.HealthCheck(ctx) // immediate first check
		for {
			select {
			case <-ticker.C:
				pool.HealthCheck(ctx)
			case <-ctx.Done():
				return
			}
		}
	}()

	addr := ":" + *port
	log.Printf("[lb] PondSite Go Load Balancer listening on http://0.0.0.0%s", addr)
	log.Printf("[lb] Backends: %v", backendPorts)
	log.Printf("[lb] SPA dist: %s", *distDir)

	srv := &http.Server{
		Addr:         addr,
		Handler:      lbHandler(pool, *distDir),
		ReadTimeout:  120 * time.Second,
		WriteTimeout: 120 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("[lb] server error: %v", err)
	}
}
