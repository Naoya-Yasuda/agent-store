# Inspect worker container (draft)
FROM python:3.11-slim AS base

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*

COPY . /app

# Clone aisev repository (optional: assume scripts/setup_aisev.sh already executed)
# RUN git clone https://github.com/Japan-AISI/aisev third_party/aisev

RUN pip install --upgrade pip \
    && pip install -r third_party/aisev/backend/requirements.txt
ENV AISEV_HOME=/app/third_party/aisev

ENTRYPOINT ["bash", "prototype/inspect-worker/scripts/entrypoint.sh"]
