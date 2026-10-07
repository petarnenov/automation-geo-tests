# Operator entry points. Playwright options go through ARGS, e.g.
#   make test ARGS="tests/billing-runs --workers=2"
#   make test ARGS="-g C25017"

ARGS ?=

.PHONY: help test config aio-post tunnel

help:
	@echo "make test [ARGS=...]  show what will run, confirm (default No), start DB tunnel, run, confirm AIO post (default Yes)"
	@echo "make config           show app URL, DB, AIO cycle, green status and comment"
	@echo "make tunnel           start the DB SSH tunnel (DB_TUNNEL_* in .env.local) if it is down"
	@echo "make aio-post         post the results saved by the last run to AIO"

test:
	@node scripts/run-suite.js run $(ARGS)

config:
	@node scripts/run-suite.js config

aio-post:
	@node scripts/aio-post.js

tunnel:
	@node scripts/db-tunnel.js
