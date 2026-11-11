#!/bin/sh
# Respaldo diario de Sovime Mensajería (autorizado por el usuario):
# copia consistente de la base de datos; se conservan los últimos 14 días.
set -e
D=$(date +%F)
# "./respaldo.sh ahora": copia nueva con hora (antes de cada cambio o actualización); sin argumento, la diaria
F="/app/data/respaldos/ultimamilla-$D.db"
[ "$1" = "ahora" ] && F="/app/data/respaldos/ultimamilla-$D-$(date +%H%M%S).db"
docker exec -e BK_FILE="$F" sovime node --disable-warning=ExperimentalWarning -e '
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const f = process.env.BK_FILE;
fs.mkdirSync("/app/data/respaldos", { recursive: true });
if (!fs.existsSync(f)) new DatabaseSync("/app/data/ultimamilla.db").prepare("VACUUM INTO ?").run(f);
console.log(new Date().toISOString(), "respaldo listo:", f);
'
find /docker/sovime/data/respaldos -name "ultimamilla-*.db" -mtime +14 -delete
# documentos del expediente del personal (privados): copia comprimida diaria
if [ -d /docker/sovime/data/expedientes ]; then
  tar -czf "/docker/sovime/data/respaldos/expedientes-$D.tar.gz" -C /docker/sovime/data expedientes
  find /docker/sovime/data/respaldos -name "expedientes-*.tar.gz" -mtime +14 -delete
fi
