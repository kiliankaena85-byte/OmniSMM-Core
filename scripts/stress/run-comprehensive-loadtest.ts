import autocannon from 'autocannon';
import { execSync } from 'child_process';

interface StageConfig {
  name: string;
  target: string;
  vus: number;
  duration: number;
  headers: Record<string, string>;
}

interface StageReport {
  stage: string;
  target: string;
  vus: number;
  duration: number;
  rps: number;
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  success2xx: number;
  non2xx: number;
  errors: number;
  timeouts: number;
  dockerCpu: string;
  dockerMem: string;
  status: string;
}

function getDockerStats(): { cpu: string; mem: string } {
  try {
    const raw = execSync(
      'docker stats --no-stream --format "{{.Name}}: CPU {{.CPUPerc}}, MEM {{.MemUsage}}"',
      { encoding: 'utf-8', timeout: 4000 }
    );
    const line = raw.split('\n').find((l) => l.includes('smmplan_web')) || '';
    const cpuMatch = line.match(/CPU ([^,]+)/);
    const memMatch = line.match(/MEM (.+)/);
    return {
      cpu: cpuMatch ? cpuMatch[1].trim() : 'N/A',
      mem: memMatch ? memMatch[1].trim() : 'N/A',
    };
  } catch {
    return { cpu: 'N/A', mem: 'N/A' };
  }
}

async function runAutocannonStage(cfg: StageConfig): Promise<StageReport> {
  console.log(`\n------------------------------------------------------------------------`);
  console.log(`🚀 [STAGE START] ${cfg.name}: ${cfg.vus} VU, duration ${cfg.duration}s`);
  console.log(`   URL: ${cfg.target}`);
  console.log(`------------------------------------------------------------------------`);

  const result = await new Promise<autocannon.Result>((resolve, reject) => {
    autocannon(
      {
        url: cfg.target,
        connections: cfg.vus,
        duration: cfg.duration,
        headers: cfg.headers,
        pipelining: 1,
      },
      (err, res) => {
        if (err) return reject(err);
        resolve(res);
      }
    );
  });

  const stats = getDockerStats();
  const p95 = result.latency.p97_5 || result.latency.p90;
  const totalRequests = result.requests.total;
  const success = result['2xx'];
  const non2xx = result.non2xx;
  const errs = result.errors;
  const timeouts = result.timeouts;

  let status = '✅ PASS';
  if (errs > 0 || timeouts > 0 || non2xx > 0) {
    const errRate = ((errs + timeouts + non2xx) / (totalRequests || 1)) * 100;
    if (errRate > 50) status = '❌ COLLAPSE';
    else if (errRate > 10) status = '⚠️ DEGRADED';
    else status = '⚠️ MINOR ERRORS';
  } else if (result.latency.p50 > 2000) {
    status = '⚠️ HIGH LATENCY';
  }

  const report: StageReport = {
    stage: cfg.name,
    target: cfg.target,
    vus: cfg.vus,
    duration: cfg.duration,
    rps: Math.round(result.requests.average),
    p50: result.latency.p50,
    p75: (result.latency as any).p75 || result.latency.p50,
    p90: result.latency.p90,
    p95: p95,
    p99: result.latency.p99,
    max: result.latency.max,
    success2xx: success,
    non2xx,
    errors: errs,
    timeouts,
    dockerCpu: stats.cpu,
    dockerMem: stats.mem,
    status,
  };

  console.log(`📊 [STAGE RESULT] ${cfg.name}:`);
  console.log(`   RPS: ${report.rps} | 2xx: ${report.success2xx} | Non-2xx: ${report.non2xx} | Errs: ${report.errors} | Timeouts: ${report.timeouts}`);
  console.log(`   Latency: P50=${report.p50}ms, P90=${report.p90}ms, P95=${report.p95}ms, P99=${report.p99}ms, Max=${report.max}ms`);
  console.log(`   Container: CPU=${report.dockerCpu} | MEM=${report.dockerMem} | Status: ${report.status}`);

  return report;
}

async function main() {
  console.log('========================================================================');
  console.log('🔥 OMNISMM 1.0 COMPREHENSIVE MULTI-STAGE LOAD BENCHMARK (2026)');
  console.log('   Testing Origin (127.0.0.1:3000) with L1-cache & PostgreSQL Pool 50');
  console.log('========================================================================');

  const defaultHeaders = {
    'Host': 'smmplan.pro',
    'x-stress-bypass': 'omni-load-2026',
    'x-tenant-id': 'smmplan',
    'User-Agent': 'Mozilla/5.0 (OmniStress/2026; HighLoadBenchmark)',
    'Accept': 'text/html,application/xhtml+xml',
  };

  const stages: StageConfig[] = [
    { name: 'Ступень 1 (10 VU)', target: 'http://127.0.0.1:3000/', vus: 10, duration: 15, headers: defaultHeaders },
    { name: 'Ступень 2 (30 VU)', target: 'http://127.0.0.1:3000/', vus: 30, duration: 15, headers: defaultHeaders },
    { name: 'Ступень 3 (100 VU)', target: 'http://127.0.0.1:3000/', vus: 100, duration: 20, headers: defaultHeaders },
    { name: 'Ступень 4 (300 VU)', target: 'http://127.0.0.1:3000/', vus: 300, duration: 20, headers: defaultHeaders },
    { name: 'Ступень 5 (500 VU)', target: 'http://127.0.0.1:3000/', vus: 500, duration: 20, headers: defaultHeaders },
    { name: 'Ступень 6 (1000 VU Spike)', target: 'http://127.0.0.1:3000/', vus: 1000, duration: 15, headers: defaultHeaders },
  ];

  const reports: StageReport[] = [];

  for (const stg of stages) {
    const report = await runAutocannonStage(stg);
    reports.push(report);
    console.log(`⏳ Пауза 5 сек для стабилизации Event Loop и сброса соединений...`);
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Summary Table
  console.log('\n=======================================================================================================');
  console.log('📋 ИТОГОВАЯ ТАБЛИЦА СТРЕСС-ТЕСТИРОВАНИЯ (ORIGIN 127.0.0.1:3000)');
  console.log('=======================================================================================================');
  console.log('| Ступень | VU | RPS | P50 (мс) | P95 (мс) | P99 (мс) | 2xx OK | Non-2xx | Errs/Timeouts | Web CPU | Web RAM | Статус |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of reports) {
    console.log(`| ${r.stage} | ${r.vus} | ${r.rps} | ${r.p50} | ${r.p95} | ${r.p99} | ${r.success2xx} | ${r.non2xx} | ${r.errors + r.timeouts} | ${r.dockerCpu} | ${r.dockerMem} | ${r.status} |`);
  }
  console.log('=======================================================================================================\n');

  // Verify DB health
  try {
    const health = execSync('curl.exe -s http://127.0.0.1:3000/api/health', { encoding: 'utf-8' });
    console.log(`🏥 Healthcheck после стресс-теста: ${health.trim()}`);
  } catch (err: any) {
    console.error(`❌ Healthcheck failed: ${err.message}`);
  }
}

main().catch(console.error);
