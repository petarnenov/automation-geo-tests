# Operator entry points. Playwright options go through ARGS, e.g.
#   make test ARGS="tests/billing-runs --workers=2"
#   make test ARGS="-g C25017"
#   make test RUNAS=grish
#   make test random 5        5 tests picked at random from the suite

ARGS ?=
# Who the run is for (a key of aio.config.json assignees) instead of being asked.
RUNAS ?=

.PHONY: help test node-check doctor setup config aio-post tunnel

# `make test random N`: the words after `test` arrive as extra goals, so
# read N from them and turn both words into no-op targets.
ifeq (random,$(word 2,$(MAKECMDGOALS)))
RANDOM_N := $(word 3,$(MAKECMDGOALS))
ifeq (,$(RANDOM_N))
$(error usage: make test random <count>)
endif
random $(RANDOM_N):
	@:
endif

help:
	@echo "make test [ARGS=...] [RUNAS=who]  choose who runs it (required), show what will run, confirm (default No), start DB tunnel, run, confirm AIO post (default Yes)"
	@echo "make test random N    same, on N tests picked at random from the suite"
	@echo "make doctor           check Node, packages, browser, Oracle driver, .env.local, AIO token, DB client/tunnel (make test runs it first)"
	@echo "make setup            install what doctor checks for: npm ci, Playwright Chromium, .env.local from .env.example"
	@echo "make config           show app URL, DB, AIO cycle, green status and comment"
	@echo "make tunnel           start the DB SSH tunnel (DB_TUNNEL_* in .env.local) if it is down"
	@echo "make aio-post         post the results saved by the last run to AIO"

test: doctor
	@$(if $(RUNAS),RUN_AS=$(RUNAS) )node scripts/run-suite.js run $(if $(RANDOM_N),--random $(RANDOM_N) )$(ARGS)

# Plain sh, so a missing or wrong Node is reported with install commands.
node-check:
	@sh scripts/check-node.sh

doctor: node-check
	@node scripts/doctor.js

setup: node-check
	npm ci
	npx playwright install chromium
	@test -f .env.local || { cp .env.example .env.local && echo "created .env.local from .env.example, fill it in"; }
	@node scripts/doctor.js

config:
	@node scripts/run-suite.js config

aio-post:
	@node scripts/aio-post.js

tunnel:
	@node scripts/db-tunnel.js
