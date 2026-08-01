FROM ghcr.io/ggerganov/llama.cpp:server

ENV LLAMA_ARG_HOST=0.0.0.0 \
    LLAMA_ARG_PORT=7860 \
    LLAMA_ARG_CTX_SIZE=4096 \
    LLAMA_ARG_N_PARALLEL=1 \
    HF_REPO=GnLOLot/MiniCPM5-1B-Claude-Opus-Fable5-Thinking-GGUF \
    HF_FILE=MiniCPM5-1B-Claude-Opus-Fable5-Thinking-Q4_K_M.gguf

# Download GGUF at build time so Space boots faster
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
  && mkdir -p /models \
  && curl -L "https://huggingface.co/${HF_REPO}/resolve/main/${HF_FILE}" -o /models/model.gguf \
  && apt-get clean && rm -rf /var/lib/apt/lists/*

CMD ["--model", "/models/model.gguf", "--host", "0.0.0.0", "--port", "7860", "-c", "4096"]
