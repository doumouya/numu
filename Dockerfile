# numu-server — the composed production image (core + apps tier; docs/ops/DEPLOY.md).
# Multi-stage: a pinned Rust builder compiles the release binary (migrations are embedded at
# compile time by sqlx::migrate!, so the image ships no .sql files); the runtime is a slim
# Debian with a non-root user. The committed web/ console rides along for the /console
# ServeDir (flag-gated; lands with its own Case — harmless before then).

# ≥1.85 required: locked deps (time 0.3.51+) use edition2024. Bump the pin when the lockfile
# outgrows it — the symptom is "feature `edition2024` is required" in Cloud Build.
FROM rust:1.96-slim-bookworm AS builder
WORKDIR /build
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY migrations ./migrations
RUN cargo build --locked --release --bin numu-server

FROM debian:bookworm-slim AS runtime
# ca-certificates: outbound TLS (Google OAuth userinfo, GitHub Contents API).
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 10001 --home /app numu
WORKDIR /app
COPY --from=builder /build/target/release/numu-server /app/numu-server
COPY web /app/web
USER numu
# Cloud Run injects PORT; config.rs binds 0.0.0.0:$PORT when NUMU_BIND is unset.
EXPOSE 8080
ENTRYPOINT ["/app/numu-server"]
