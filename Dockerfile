FROM python:3.13-slim-bookworm

ARG LANGUAGETOOL_VERSION=6.6

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV LANGUAGETOOL_URL=http://127.0.0.1:8081/v2/check
ENV LANGUAGETOOL_LANGUAGE=en-US

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        unzip \
        openjdk-17-jre-headless \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./

RUN pip install --no-cache-dir -r requirements.txt

RUN mkdir -p /opt/languagetool /tmp/languagetool \
    && curl -fsSL \
        "https://languagetool.org/download/LanguageTool-${LANGUAGETOOL_VERSION}.zip" \
        -o /tmp/languagetool.zip \
    && unzip -q /tmp/languagetool.zip -d /tmp/languagetool \
    && cp -a \
        "/tmp/languagetool/LanguageTool-${LANGUAGETOOL_VERSION}/." \
        /opt/languagetool/ \
    && rm -rf /tmp/languagetool /tmp/languagetool.zip

COPY spellcheck.py spellcheckAPI.py start.sh ./

RUN chmod +x /app/start.sh

EXPOSE 10000

CMD ["/app/start.sh"]