ARG RUNNERS_BASE_IMAGE=n8nio/runners:2.10.3

FROM node:22-bookworm-slim AS package-install
WORKDIR /opt/n8n-blocks
COPY src/n8n/package/package.json ./package/package.json
COPY src/n8n/package/package.manifest.json ./package/package.manifest.json
COPY src/n8n/package/nodes ./package/nodes
COPY src/n8n/package/shared ./package/shared
RUN mkdir -p ./loader \
  && printf '{\n  "private": true,\n  "dependencies": {\n    "@igasovic/n8n-blocks": "file:../package"\n  }\n}\n' > ./loader/package.json \
  && cd ./loader \
  && npm install --omit=dev --ignore-scripts

FROM ${RUNNERS_BASE_IMAGE}
COPY --from=package-install /opt/n8n-blocks/loader/node_modules/ /usr/local/lib/node_modules/n8n/node_modules/
COPY src/n8n/package/ /usr/local/lib/node_modules/n8n/node_modules/igasovic-n8n-blocks/
