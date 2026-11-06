#!/bin/sh
# Respaldo diario de Sovime Mensajería (autorizado por el usuario):
# copia consistente de la base de datos; se conservan los últimos 14 días.
set -e
D=$(date +%F)
docker exec -e BK_FILE="/app/data/respaldos/ultimamilla-$D.db" sovime node --disable-warning=ExperimentalWarning -e '
const { DatabaseSync } = require("node:sqlite");
const fs = require("fs");
const f = process.env.BK_FILE;
fs.mkdirSync("/app/data/respaldos", { recursive: true });
if (!fs.existsSync(f)) new DatabaseSync("/app/data/ultimamilla.db").prepare("VACUUM INTO ?").run(f);
console.log(new Date().toISOString(), "respaldo listo:", f);
'
find /docker/sovime/data/respaldos -name "ultimamilla-*.db" -mtime +14 -delete
