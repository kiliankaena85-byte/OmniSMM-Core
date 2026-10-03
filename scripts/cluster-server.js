// scripts/cluster-server.js
// High-concurrency cluster runner for Next.js standalone on multi-core systems
const cluster = require('cluster');
const os = require('os');
const path = require('path');
const fs = require('fs');

const useCluster = process.env.ENABLE_CLUSTER !== 'false';
// Use up to 3 workers on 4-core machine to prevent OS / DB starvation
const availableCores = os.cpus().length;
const defaultWorkers = Math.max(1, Math.min(3, availableCores - 1));
const numWorkers = parseInt(process.env.CLUSTER_WORKERS, 10) || defaultWorkers;

if (useCluster && cluster.isPrimary && numWorkers > 1) {
  console.log(`[OmniSMM Cluster] Master PID ${process.pid} is online (${availableCores} host cores detected).`);
  console.log(`[OmniSMM Cluster] Forking ${numWorkers} worker processes with automatic restart...`);

  // SPEC-POSTDEPLOY-POOL-SYNC-2026: воркеры наследуют env — db.ts делит бюджет пула на фактическое число воркеров
  process.env.CLUSTER_WORKERS = String(numWorkers);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('online', (worker) => {
    console.log(`[OmniSMM Cluster] Worker PID ${worker.process.pid} is active and listening.`);
  });

  cluster.on('exit', (worker, code, signal) => {
    console.warn(`[OmniSMM Cluster] Worker PID ${worker.process.pid} exited (${signal || code}). Respawning replacement worker...`);
    cluster.fork();
  });

  // Graceful shutdown forwarding to all workers
  const handleShutdown = (signal) => {
    console.log(`[OmniSMM Cluster] Master received ${signal}. Gracefully stopping workers...`);
    for (const id in cluster.workers) {
      const worker = cluster.workers[id];
      if (worker && worker.process) {
        worker.process.kill(signal);
      }
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
  process.on('SIGINT', () => handleShutdown('SIGINT'));
} else {
  // Install RAM Microcache & TCP Backlog (65535) Engine before starting Next.js server
  try {
    const microcachePath = path.join(__dirname, 'microcache-engine.js');
    const { installMicrocacheEngine } = require(microcachePath);
    installMicrocacheEngine({
      ttlMs: parseInt(process.env.STOREFRONT_CACHE_TTL_MS, 10) || 10000,
    });
  } catch (err) {
    console.warn('[OmniSMM Cluster] Warning: Microcache engine failed to initialize:', err.message);
  }

  // Resolve Next.js standalone server portably
  let serverPath = path.join(__dirname, 'server.js');
  if (!fs.existsSync(serverPath)) {
    const standaloneServer = path.join(__dirname, '../.next/standalone/server.js');
    if (fs.existsSync(standaloneServer)) {
      serverPath = standaloneServer;
    }
  }

  // Worker process or standalone fallback: execute standard Next.js standalone server
  require(serverPath);
}
