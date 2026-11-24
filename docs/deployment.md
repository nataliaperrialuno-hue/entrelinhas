# Deploy de produção

Este guia descreve o deploy do Entrelinhas com Docker Compose. O tráfego entra pelo Caddy (portas 80/443), que termina o TLS e faz proxy para o Express na porta `3001` — essa porta **não** é publicada na host. O banco SQLite fica no volume nomeado `entrelinhas-data`.

## Pré-requisitos

- Docker 29.7.2 ou superior, com daemon ativo, e Compose v5.5.1 ou superior (`docker compose version`).
- Node.js 24 disponível apenas no host para gerar o segredo (ou qualquer forma de gerar 32 bytes aleatórios).
- Para um domínio real: DNS apontando para o host e portas 80/443 liberadas no firewall. Para testar localmente, use `localhost`.
- Cópia do repositório com os arquivos `Dockerfile`, `docker-compose.yml`, `Caddyfile` e `.dockerignore` na raiz.

## Primeira instalação

1. Crie o arquivo de ambiente a partir do modelo (ele é ignorado pelo Git):

   ```bash
   cp .env.example .env
   ```

2. Gere um segredo aleatório de 32 bytes e cole o resultado em `TOKEN_HMAC_SECRET` no `.env`:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

3. Ajuste ainda no `.env` o domínio atendido e a URL pública usada na montagem dos links:

   ```dotenv
   # Teste local
   ENTRELINHAS_DOMAIN=localhost
   PUBLIC_APP_URL=https://localhost

   # Domínio real (substitua pelo seu)
   ENTRELINHAS_DOMAIN=cartas.exemplo.com
   PUBLIC_APP_URL=https://cartas.exemplo.com
   ```

   O `NODE_ENV` do `.env` é `development` no modelo; o Compose sobrescreve para `production`. Não publique a porta `3001`.

4. Suba os serviços:

   ```bash
   docker compose up -d --build
   ```

## Verificação

```bash
# status dos contêineres (app deve estar "healthy")
docker compose ps

# healthcheck da API pelo Caddy (-k só é necessário com certificado interno)
curl -k https://localhost/api/health

# fallback SPA da rota de leitura deve responder com o index.html
curl -kI https://localhost/leitura/teste
```

Para um domínio com certificado ACME válido, remova o `-k`. Logs: `docker compose logs -f app` e `docker compose logs -f caddy`.

## Volumes e backup

| Volume | Conteúdo |
| --- | --- |
| `entrelinhas-data` | Banco SQLite (`entrelinhas.db`, `-wal`, `-shm`) em `/app/backend/data`. |
| `caddy-data` | Certificados e estado do ACME. |
| `caddy-config` | Configuração runtime do Caddy. |

Backup consistente do banco em execução (usa `VACUUM INTO`, disponível no Node 24):

```bash
docker compose exec -T app node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/app/backend/data/entrelinhas.db'); db.exec(\"VACUUM INTO '/tmp/entrelinhas-backup.db'\"); db.close();"
docker compose cp app:/tmp/entrelinhas-backup.db ./entrelinhas-backup.db
```

Cópia integral do volume (o nome real inclui o prefixo do projeto Compose):

```bash
VOLUME="$(docker inspect -f '{{ (index .Mounts 0).Name }}' "$(docker compose ps -q app)")"
docker run --rm -v "${VOLUME}:/data:ro" -v "${PWD}:/backup" alpine:3.21 \
  tar czf /backup/entrelinhas-data.tgz -C /data .
```

Restauração: pare os serviços (`docker compose down`), descompacte o arquivo no volume com `docker run --rm -v "${VOLUME}:/data" -v "${PWD}:/backup" alpine:3.21 sh -c 'tar xzf /backup/entrelinhas-data.tgz -C /data'`, depois suba novamente com `docker compose up -d --build`. Faça um backup antes de qualquer atualização.

## Atualização

```bash
git pull
docker compose up -d --build
docker compose pull caddy && docker compose up -d caddy
docker compose ps
```

O build recria a imagem da aplicação; os volumes nomeados são preservados. Verifique o healthcheck após a subida.

## Rollback

```bash
git log --oneline -5
git checkout <commit-anterior>
docker compose up -d --build
```

Se a versão anterior alterou o esquema do banco, restaure também o backup correspondente **antes** de voltar a subir a aplicação. Não tente rodar uma versão antiga do código contra um banco migrado para um esquema mais novo.

## TLS/HTTPS é obrigatório

Em produção o cookie de leitura é `__Host-entrelinhas_read`, com `Secure`, `HttpOnly`, `SameSite=Strict` e `Path=/`, sem atributo `Domain`. O prefixo `__Host-` só é aceito pelo navegador em HTTPS; sem TLS o cookie é descartado e a leitura única quebra. O Caddy emite certificado interno para `localhost` e usa ACME para domínios reais — nunca desative o HTTPS ou faça proxy direto para a porta `3001`.

## Segredo e versionamento

`.env` contém `TOKEN_HMAC_SECRET` e **nunca** deve ser versionado ou embutido na imagem (o `.dockerignore` e o `.gitignore` já o excluem). Compartilhe apenas o `.env.example`, sem valores reais. Se o segredo vazar, gere um novo, atualize o `.env` e reinicie o serviço com `docker compose up -d --force-recreate app`.
