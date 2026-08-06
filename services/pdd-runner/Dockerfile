FROM python:3.12.11-slim

ARG PDD_CLI_VERSION=0.0.309
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && python -m pip install --no-cache-dir "pdd-cli==${PDD_CLI_VERSION}"

WORKDIR /app
COPY server.py /app/server.py

ENV PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PDD_FORCE_LOCAL=1 \
    PDD_CLOUD_RUN=false

USER 65532:65532
CMD ["python", "/app/server.py"]
