# SUN Messenger — Release Checklist (v1)

Дата шаблона: 2026-05-01

## 1) Release freeze

1. Зафиксировать релизный commit и тег.
2. Остановить внесение не-критичных изменений в `main`.
3. Назначить окно релиза и ответственного за откат.

## 2) Production env (обязательно)

Проверить `/srv/sunmessenger/shared/.env`:

```env
APP_ENV=production
APP_DEBUG=0

SECRET_KEY=<long-random-secret-32-bytes-minimum>

DATABASE_URL=postgresql://sunmessenger:<password>@127.0.0.1:5432/sunmessenger
DATABASE_BACKUP_DIR=/srv/sunmessenger/shared/backups

REDIS_URL=redis://127.0.0.1:6379/0
RATELIMIT_STORAGE_URI=redis://127.0.0.1:6379/1
SOCKETIO_MESSAGE_QUEUE=redis://127.0.0.1:6379/2
SOCKETIO_CORS_ORIGINS=https://sunmessenger.ru,https://www.sunmessenger.ru

RUN_MIGRATIONS_ON_STARTUP=0
START_SCHEDULER_IN_WEB=0
ALLOW_EMBEDDED_WEB_SERVER=0
ALLOW_UNSAFE_WERKZEUG=0
FORCE_HTTPS=1
SESSION_COOKIE_SECURE=1

PROXY_FIX_X_FOR=1
PROXY_FIX_X_PROTO=1
PROXY_FIX_X_HOST=1
PROXY_FIX_X_PORT=1
PROXY_FIX_X_PREFIX=0

CHAT_MEDIA_CACHE_MAX_AGE_SECONDS=3600
CHAT_MEDIA_AV_SCAN_ENABLED=1
CHAT_MEDIA_AV_FAIL_CLOSED=1
CHAT_MEDIA_AV_COMMAND=clamdscan --fdpass --no-summary {path} || clamscan --no-summary --infected --stdout {path}
CHAT_MEDIA_AV_SCAN_EXTENSIONS=zip,rar,7z
```

Генерация секретов:

```bash
python - <<'PY'
import secrets
print("SECRET_KEY=" + secrets.token_urlsafe(64))
PY
```

## 3) Systemd и Nginx

Проверить юниты:

1. `deploy/systemd/sunmessenger-web.service`
2. `deploy/systemd/sunmessenger-scheduler.service`
3. `deploy/systemd/sunmessenger-maintenance.service`

Проверить nginx-конфиг:

1. `deploy/nginx/sunmessenger.conf`
2. `client_max_body_size 100m` совпадает с лимитом приложения.
3. Проксируются `X-Forwarded-*` заголовки.

Команды:

```bash
sudo nginx -t
sudo systemctl daemon-reload
```

## 4) Preflight на сервере (до рестарта web)

Рабочая директория:

```bash
cd /srv/sunmessenger/current
source /srv/sunmessenger/venv/bin/activate
```

Проверить системные утилиты для PostgreSQL backups и AV scan:

```bash
sudo apt-get install -y postgresql-client clamav clamav-daemon
which pg_dump pg_restore clamdscan clamscan
```

Обновить зависимости:

```bash
pip install -r requirements-production.txt
```

Проверка security baseline, backup tooling, миграций и целостности:

```bash
python manage.py security-check --env production
python manage.py maintenance --env production --backup-dir /srv/sunmessenger/shared/backups
python manage.py maintenance --env production --integrity-only
```

Проверка, что приложение поднимается:

```bash
python - <<'PY'
from app import create_app
app = create_app('production')
print("ok", app.config["ENV_NAME"], app.config["DATABASE_URL"].split("@")[-1])
PY
```

## 5) Перезапуск сервисов

```bash
sudo systemctl restart sunmessenger-web.service
sudo systemctl restart sunmessenger-scheduler.service
sudo systemctl status sunmessenger-web.service --no-pager
sudo systemctl status sunmessenger-scheduler.service --no-pager
```

## 6) Smoke tests (обязательно сразу после выката)

HTTP/заголовки:

```bash
curl -I https://sunmessenger.ru/
curl -I https://sunmessenger.ru/chat
```

Проверить вручную из браузера:

1. Login.
2. Открытие существующего чата.
3. Отправка текста.
4. Отправка картинки/видео/аудио.
5. Догрузка старых сообщений вверх.
6. Поиск пользователя.
7. Редактирование и удаление сообщения.
8. Logout.

Socket/realtime:

1. Два клиента в разных вкладках.
2. Проверка typing, delivery/read, reaction.
3. Переподключение после краткого offline.

## 7) Наблюдаемость первые 30–60 минут

Логи:

```bash
sudo journalctl -u sunmessenger-web.service -f
sudo journalctl -u sunmessenger-scheduler.service -f
```

Проверить отсутствие:

1. Массовых `500`.
2. Ошибок `socket rate-limit storage`.
3. Ошибок БД (`database is locked`, missing column).
4. Резкого роста latency на `/get_chat_history` и `/chat_media/<id>`.

## 8) Rollback plan (должен быть готов заранее)

1. Иметь предыдущий стабильный релиз в `/srv/sunmessenger/releases/<prev>`.
2. Переключить `current` на `<prev>`.
3. Восстановить БД из последнего pre-maintenance backup (если rollback требует rollback схемы/данных):

```bash
python manage.py maintenance --env production --restore-from /srv/sunmessenger/shared/backups/<backup-file>.dump --integrity-only --no-backup
```

4. Перезапустить web/scheduler и повторить smoke.

## 9) Что желательно закрыть до public launch (если успеваешь)

1. Sentry (backend + frontend) с release/version tag.
2. Простые uptime checks (`/`, `/chat`).
3. Ежедневный backup cron + тест restore раз в неделю.
4. Отдельный “runbook инцидента” (кто/что/куда пишет при аварии).
