/**
 * RESEARCH JOB QUEUE — jobs pesados fora do relay (child process), com limites e persistencia.
 *
 * Trading/feed tem prioridade: jobs rodam com `nice` logico (concorrencia baixa) e timeout.
 * Estados: QUEUED/RUNNING/COMPLETED/FAILED/CANCELLED. Nunca bloqueia o hot path.
 */
import { fork } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JOB_STATES } from "./contracts.mjs";

export const RESEARCH_JOBS_VERSION = "research-job-queue-v1";
const WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "research-worker.mjs");

export const DEFAULT_RESOURCE_LIMITS = Object.freeze({
  concurrency: 1, timeoutMs: 120_000, maxJobsPerHour: 60, cpuPriority: "BELOW_NORMAL",
});

export class ResearchJobQueue {
  constructor({ pool = null, now = () => Date.now(), concurrency = DEFAULT_RESOURCE_LIMITS.concurrency, timeoutMs = DEFAULT_RESOURCE_LIMITS.timeoutMs, maxJobsPerHour = DEFAULT_RESOURCE_LIMITS.maxJobsPerHour, workerPath = WORKER_PATH, log = () => {} } = {}) {
    this.pool = pool; this.now = now; this.log = (...args) => { try { log(...args); } catch { /* noop */ } };
    this.limits = { concurrency, timeoutMs, maxJobsPerHour, cpuPriority: DEFAULT_RESOURCE_LIMITS.cpuPriority };
    this.workerPath = workerPath;
    this.jobs = new Map();
    this.running = new Set();
    this.hourMarks = [];
    this.seq = 0;
  }

  #rateOk() {
    const now = this.now();
    this.hourMarks = this.hourMarks.filter((at) => now - at < 3_600_000);
    return this.hourMarks.length < this.limits.maxJobsPerHour;
  }

  async enqueue({ type, payload = {}, requestedBy = "research" } = {}) {
    if (!this.#rateOk()) return { ok: false, reason: "RATE_LIMIT" };
    const job = { jobId: `job_${++this.seq}_${crypto.randomBytes(3).toString("hex")}`, type, payload, requestedBy, status: "QUEUED", progress: 0, createdAt: this.now(), startedAt: null, finishedAt: null, result: null, error: null, log: [] };
    this.jobs.set(job.jobId, job);
    this.hourMarks.push(this.now());
    await this.#persist(job);
    queueMicrotask(() => this.#pump());
    return { ok: true, job: this.view(job) };
  }

  #pump() {
    while (this.running.size < this.limits.concurrency) {
      const next = [...this.jobs.values()].find((job) => job.status === "QUEUED");
      if (!next) return;
      this.#run(next);
    }
  }

  #run(job) {
    job.status = "RUNNING"; job.startedAt = this.now();
    let child = null;
    try {
      child = fork(this.workerPath, [], { env: { ...process.env, RESEARCH_JOB_TYPE: job.type, RESEARCH_JOB_PAYLOAD: JSON.stringify(job.payload ?? {}) }, stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true });
    } catch (error) {
      job.status = "FAILED"; job.error = String(error?.message ?? error).slice(0, 200); job.finishedAt = this.now();
      void this.#persist(job); this.running.delete(job.jobId);
      return;
    }
    this.running.add(job.jobId);
    const timer = setTimeout(() => { job.status = "FAILED"; job.error = "TIMEOUT"; try { child?.kill(); } catch { /* noop */ } }, this.limits.timeoutMs);
    timer.unref?.();
    child.on("message", (message) => {
      if (message?.progress !== undefined) job.progress = Number(message.progress) || job.progress;
      if (message?.log) job.log.push(String(message.log).slice(0, 300));
      void this.#persist(job);
    });
    child.on("error", (error) => { job.error = String(error?.message ?? error).slice(0, 200); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      this.running.delete(job.jobId);
      if (job.status === "RUNNING") {
        if (code === 0) { job.status = "COMPLETED"; job.progress = 1; } else { job.status = "FAILED"; job.error = job.error ?? `EXIT_${code}`; }
      }
      job.finishedAt = this.now();
      void this.#persist(job);
      this.#pump();
    });
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job || !["QUEUED", "RUNNING"].includes(job.status)) return { ok: false, reason: "NOT_CANCELLABLE" };
    job.status = "CANCELLED"; job.finishedAt = this.now();
    void this.#persist(job);
    return { ok: true, job: this.view(job) };
  }

  view(job) { return { jobId: job.jobId, type: job.type, status: job.status, progress: job.progress, requestedBy: job.requestedBy, createdAt: job.createdAt, startedAt: job.startedAt, finishedAt: job.finishedAt, error: job.error, resultPreview: job.result ? JSON.stringify(job.result).slice(0, 500) : null, logTail: job.log.slice(-5) }; }

  list(limit = 50) { return [...this.jobs.values()].slice(-limit).reverse().map((job) => this.view(job)); }

  status() {
    return {
      version: RESEARCH_JOBS_VERSION, limits: this.limits,
      counts: JOB_STATES.reduce((acc, state) => { acc[state] = [...this.jobs.values()].filter((job) => job.status === state).length; return acc; }, {}),
      running: this.running.size, total: this.jobs.size, hotPathPriority: true,
    };
  }

  async #persist(job) {
    if (!this.pool?.query) return;
    try {
      await this.pool.query(
        `INSERT INTO iq_research_jobs(id, type, status, progress, requested_by, payload, result, error, created_at, updated_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,now(),now())
         ON CONFLICT(id) DO UPDATE SET status=$3, progress=$4, result=$7::jsonb, error=$8, updated_at=now()`,
        [job.jobId, job.type, job.status, job.progress, job.requestedBy, JSON.stringify(job.payload ?? {}), JSON.stringify(job.result ?? null), job.error],
      );
    } catch { /* persistencia nunca derruba o job */ }
  }
}
