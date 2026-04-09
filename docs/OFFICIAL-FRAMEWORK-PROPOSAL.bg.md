# GeoWealth E2E Test Framework — Архитектурно предложение

> **Бележка за статуса.** Това е български паралелен превод на `OFFICIAL-FRAMEWORK-PROPOSAL.md`. Английската версия е canonical (corporate standard); тази версия съществува за вътрешни stakeholders. При разминаване между двете — английската е авторитетна. Code blocks, file paths, ID-та (D-XX, R-XX, M-X) и устойчивите технически термини (Page Object, fixture, monorepo, workspace, scaffold, smoke, regression, и т.н.) остават на английски умишлено.

| Поле | Стойност |
|---|---|
| **Document ID** | QA-ARCH-001 |
| **Статус** | Чернова за ревю |
| **Версия** | 1.2 (паралелен BG превод) |
| **Последна редакция** | 2026-04-09 |
| **Автор** | QA Automation |
| **Аудитория** | QA leads, Engineering managers, Platform / DevOps, Frontend leads |
| **Branch** | `feat/corporate-e2e-migration` |

---

## Резюме за ръководство

Текущото repo `automation-geo-tests` е **proof of concept**, който успешно достави tagged подмножество от автоматизирани тестове (TestRail Run 175, `@pepi` label) срещу средите qa2/qa3 на GeoWealth. Той валидира, че Playwright е жизнеспособен runner за GeoWealth стека, и произведе reusable артефакти — най-вече hybrid per-worker test isolation модел и библиотека от React widget primitives.

Този документ предлага преходът от POC към **официален, корпоративен end-to-end (E2E) test framework**. Предложението:

1. Описва силните страни на POC-а и структурния debt, който блокира скалирането.
2. Подравнява дизайна на framework-а с архитектурата на системата под тест (Struts 2 + React 18 monolith).
3. Дефинира целевата архитектура, технологичен стек, repository layout, и инженерни конвенции.
4. Специфицира ежедневните операции: pipelines, secrets, observability, ownership, и flake management.
5. Полага фазиран, неразрушителен миграционен план, който запазва TestRail reporting-а на POC-а през целия преход.
6. Записва решения, зависимости, рискове и success metrics, така че програмата да е measurable от ден едно.

Очакваният резултат е maintainable, ревюируем и scalable test asset, който QA, Engineering и Platform организациите могат съвместно да owner-ват.

**Headline asks към stakeholder-ите:**
1. Одобри TypeScript strict mode и version-pinning политиката (Decisions D-01, D-19).
2. **Одобри monorepo с npm workspaces** (Decision D-24, supersedes D-04) и седемте team packages (Trading, Platform, Billing & Servicing, Reporting, Investments, Integrations, Custody & PA), със scaffold script като Phase 1 deliverable (D-26).
3. Authorize незабавна Phase 0 day-1 credential rotation на `testrail.config.json` (Decisions D-11, D-22) и pre-decide дали историческият leak в git се rewrite-ва или формално се приема (Decision D-20).
4. Назначи единен Program Owner, отговорен за миграцията (Section 6.14), и named Security counterpart (D-22). Phase 0 не може да започне без двамата.
5. Номинирай CI platform и secret store (Decisions D-02, D-03). CI е Phase 1 deliverable, не Phase 3 chore.
6. Ангажирай frontend owner за `data-testid` rollout (Decision D-05) — и приеми, че при седем екипа това може да трябва да се раздели per team. Phase 5 не може да приключи без това.
7. Ангажирай втори QA Automation contributor до края на Phase 1 (Risk R-11, milestone M3). Това е най-трудният не-технически ангажимент на програмата.
8. Признай kill criteria-та в Section 6.14 — програмата има право да спре, и условията за спиране са експлицитни.

---

## 1. Речник

| Термин | Дефиниция |
|---|---|
| **SUT** | System Under Test — GeoWealth web приложението (`~/nodejs/geowealth`). |
| **POC** | Текущата proof-of-concept сюита в `~/automation-geo-tests`. |
| **POM** | Page Object Model — design pattern, който капсулира page selectors и actions в класове. |
| **Fixture** | Playwright конструкт, осигуряващ setup/teardown и shared state на тест или worker. |
| **Worker** | Playwright-managed Node.js процес, който изпълнява тестове паралелно. |
| **firmCd** | Главният multi-tenant идентификатор на GeoWealth (firm code). |
| **`/qa/*`** | Struts namespace, който излага test-only data-seeding endpoints, gated от GW admin role. |
| **TestRail Run 175** | TestRail run-ът, който в момента отразява `@pepi` regression scope-а. |
| **Hash route** | React Router v5 hash-based URL като `#/login`, `#/advisors`. |

---

## 2. Оценка на текущото състояние (POC)

### 2.1 Активи за запазване

| Актив | Локация | Защо остава |
|---|---|---|
| Per-worker dummy firm isolation | `tests/_helpers/worker-firm.js` | Елиминира cross-test races под parallel load, давайки на всеки worker изолирана firm чрез `/qa/createDummyFirm.do`. |
| React widget primitives | `tests/_helpers/ui.js` | Battle-tested helpers за `react-date-picker`, ComboBox, ag-Grid editors, numeric inputs. Hardened срещу няколко React-hydration races. |
| TestRail reporter | `reporters/testrail-reporter.js` | Работеща интеграция с retry, dual-auth (password/API key) fallback, конфигурируем result mapping. |
| Lint и formatting baseline | `eslint.config.mjs`, `.prettierrc.json` | ESLint 10 flat config плюс Playwright plugin и Prettier вече enforced. |
| Hybrid isolation pattern | Документиран през `account-billing/` спецовете | Phase 1 мутира per-worker firms; Phase 2 чете от static shared firm. Pattern-ът е стабилен и трябва да се формализира. |

### 2.2 Структурен debt, блокиращ scale-up

| Проблем | Impact | Severity |
|---|---|---|
| Без TypeScript (само CommonJS, JSDoc-only types) | Никаква compile-time refactor safety; IDE assistance ограничен. | High |
| Без Page Object Model | Selectors и workflows дублирани inline през спецовете. | High |
| Credentials commit-нати в `testrail.config.json` | Security и compliance risk. | Critical |
| Hardcoded environment (`qa3.geowealth.com`) | Без multi-environment switching; manual edit нужен за retarget. | High |
| Pattern duplication през spec families | Всеки `account-billing` и `create-account` spec повтаря същата външна форма. | Medium |
| Magic identifiers разпръснати из helpers | Apple instrument UUID, Firm 106 IDs, role usernames. | Medium |
| Ad-hoc test data generation | `Date.now().slice(-6)` за uniqueness; без factories. | Medium |
| Без CI configuration | Сюитата работи само локално; няма shared, reproducible execution. | High |
| Без secret management discipline | Един `.json` файл държи всички credentials. | Critical |

---

## 3. Система под тест — архитектурен контекст

Тези свойства на GeoWealth приложението (`~/nodejs/geowealth`) директно оформят framework design choices.

| Слой | Технология | Test-relevant impact |
|---|---|---|
| Backend | Java 17, Apache Struts 2 (`.do` extension), Akka actors, Gradle | Test endpoints са `.do` actions, не REST. Responses обикновено са JSON. |
| Frontend | React 18, Redux, React Query 5, React Router v5 (hash routing), ag-Grid Enterprise | Hash routes (`#/...`); ag-Grid Enterprise е широко разпространен; `data-testid` coverage е оскъдно и непоследователно. |
| Auth | Session/cookie based, `LoginInterceptor` на всеки action | Multi-tenant scoping е per `firmCd`. Roles: GW admin, firm admin, advisor, client. |
| Test data hooks | `/qa/*` Struts namespace gated от `CommonGwAdminQaAction.canExecuteAction()` | `createDummyFirm`, `createInvitationToken`, `importCustodianAccount`, `simulateSchwabTransaction`, `executeMFs`, `uploadTPAMFile`, `createCrntCostBasis*`, и т.н. |
| Среди | `qa1`–`qa10`, `qatrd`, staging, production; всяка със server template под `conf/server_templates/` | Multi-environment е first-class изискване. |
| Съществуващ QA tooling | Backend JUnit, frontend Jest. **Без съществуващ E2E framework.** | Greenfield — няма legacy E2E suite за поддръжка или миграция. |
| Документация | Вътрешен Confluence под `development.geowealth.com/confluence` | Framework documentation трябва да cross-reference-ва Confluence където е авторитетен. |

---

## 4. Целева архитектура

### 4.1 Технологичен стек

| Concern | Избор | Обосновка |
|---|---|---|
| Език | **TypeScript (strict mode)** | Compile-time safety е essential за дълготрайна сюита; refactor cost доминира с времето. |
| Test runner | **Playwright Test** | Вече adopted, mature parallelism, built-in tracing, fixtures, и reporters. |
| Schema validation | **Zod** | Runtime validation на `/qa/*` responses; защитава тестовете от тих backend contract drift. |
| Environment management | **`dotenv-flow`** | Layered `.env.<env>`, `.env.local`, `.env.<env>.local` semantics се mappa-т естествено към qa1–qa10. |
| Test data faking | **`@faker-js/faker`** | Industry standard за synthetic names, addresses, emails. |
| Linting | **ESLint 10 flat config + `eslint-plugin-playwright` + `@typescript-eslint`** | Продължение на POC baseline (POC-ът вече ползва ESLint 10) плюс TypeScript awareness. |
| Formatting | **Prettier** | Вече adopted. |
| Package manager | **npm** | Продължение на POC baseline. |

### 4.2 Repository Topology — Monorepo с npm Workspaces

GeoWealth E2E е **monorepo**, изграден върху **npm workspaces** (Decision **D-24**, supersedes D-04). Хоства един shared framework package и един test package на consuming team. Нови екипи се onboard-ват чрез scaffold script (Section 4.2.4) и стават продуктивни в рамките на минути.

#### 4.2.1 Top-Level Layout

```
geowealth-e2e/                          ← monorepo root
├── package.json                        ← workspace root: workspaces, scripts, tooling
├── package-lock.json                   ← single lockfile for the whole monorepo
├── tsconfig.base.json                  ← shared compiler options; each package extends
├── .nvmrc                              ← Node 20 LTS pin
├── .env.example                        ← template; never holds real secrets
├── .gitignore
├── .eslintrc.legacy-areas.json         ← machine-readable freeze list (Section 6.11)
├── CODEOWNERS                          ← per-package review routing
├── packages/
│   ├── framework/                      ← @geowealth/e2e-framework — the shared substrate
│   │   ├── src/
│   │   │   ├── config/                 ← environments, dotenv-flow loader
│   │   │   ├── fixtures/               ← base, auth, firm, api fixtures + globalSetup
│   │   │   ├── pages/                  ← shared Page Objects (Login, Navigation, FirmAdmin, ...)
│   │   │   ├── components/             ← React widget primitives (ReactDatePicker, ComboBox, AgGrid, NumericInput, TypeAhead)
│   │   │   ├── api/                    ← typed clients for .do endpoints (qa/, react/, bo/)
│   │   │   ├── data/                   ← factories, constants, XLSX builders
│   │   │   ├── helpers/                ← waits, retry, uuid, cdp
│   │   │   ├── types/                  ← shared TS types mirroring Java entities
│   │   │   ├── reporters/              ← testrail-reporter (the framework owns it)
│   │   │   └── index.ts                ← public surface; what teams may import
│   │   ├── tests/                      ← framework's own unit/smoke tests
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── tooling/                        ← @geowealth/e2e-tooling — CLI utilities
│   │   ├── src/
│   │   │   ├── scaffold-team.ts        ← THE scaffold script (Section 4.2.5)
│   │   │   ├── testid-coverage.ts
│   │   │   ├── tracker-update.ts
│   │   │   └── eslint-rules/
│   │   └── package.json
│   ├── tests-billing-servicing/        ← @geowealth/tests-billing-servicing  (owns the entire current POC scope)
│   │   ├── tests/
│   │   │   ├── smoke/
│   │   │   ├── regression/
│   │   │   │   ├── account-billing/
│   │   │   │   ├── billing-specs/
│   │   │   │   ├── create-account/
│   │   │   │   ├── bucket-exclusions/
│   │   │   │   ├── unmanaged-assets/
│   │   │   │   ├── merge-prospect/
│   │   │   │   └── auto-link/
│   │   │   └── journeys/
│   │   ├── src/pages/
│   │   ├── playwright.config.ts
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── tests-platform/                 ← @geowealth/tests-platform
│   ├── tests-trading/                  ← @geowealth/tests-trading
│   ├── tests-reporting/                ← @geowealth/tests-reporting
│   ├── tests-investments/              ← @geowealth/tests-investments
│   ├── tests-integrations/             ← @geowealth/tests-integrations
│   ├── tests-custody-pa/               ← @geowealth/tests-custody-pa
│   └── legacy-poc/                     ← @geowealth/legacy-poc — interim home for the existing POC
│       ├── tests/
│       ├── reporters/
│       ├── playwright.config.js
│       └── package.json
├── .github/workflows/
│   ├── pr-gate.yml
│   ├── nightly.yml
│   └── scaffold-test.yml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── WRITING-TESTS.md
│   ├── PAGE-OBJECTS.md
│   ├── ONBOARDING.md
│   ├── SCAFFOLD.md
│   ├── migration-tracker.md
│   ├── status-report-template.md
│   ├── CHANGELOG.md
│   ├── adr/
│   └── phase-verifications/
└── scripts/
    ├── changed-packages.sh
    └── ci-matrix.ts
```

#### 4.2.2 Package Boundaries — какво къде отива

Най-важното правило на monorepo-то: **framework пакетът не знае нищо за никой team package, но всеки team package зависи от framework-а**. Зависимостите текат само в една посока.

| Package | Зависи от | Owned by | Какво отива тук |
|---|---|---|---|
| `framework/` | (нищо вътрешно) | QA Automation | Всичко, което е **reusable за два или повече екипа**: Page Objects за shared screens (Login, Navigation, FirmAdmin), Component classes, API client (`qa/`, `react/`, `bo/`), fixtures, factories, types, TestRail reporter. |
| `tooling/` | `framework/` (само devDep) | QA Automation | CLI utilities. Никога не се import-ват от тестове. Scaffold script-ът живее тук. |
| `tests-<team>/` | `framework/` | Екипът | Spec-овете на екипа, *team-specific* Page Objects (тези, които не се обобщават за други екипи), `playwright.config.ts` (extends framework base config), tracking issues. |
| `legacy-poc/` | (нищо) | QA Automation (interim) | Съществуващият JS POC, преместен непокътнат. Изтрит при Phase 5 sunset. |

**Promotion rule.** Page Object или helper, започнал в `tests-<team>/src/`, може да бъде promoted в `framework/src/` веднъж щом *втори* екип има нужда от него. Promotion-ът е един PR, owned от QA Automation, с originating team като co-author. Promotion-ът е *единственият* начин нов код да попадне в `framework/`.

**Anti-pattern: cross-team imports.** Spec в `tests-billing-servicing/` **не** може да import-ва от `tests-trading/`. Ако два екипа споделят state или flows, споделената част е promoted в `framework/`. CI enforce-ва това чрез ESLint rule (`local-rules/no-cross-team-import`), shipped от `packages/tooling/`.

#### 4.2.3 TypeScript и Playwright Config йерархия

Един `tsconfig.base.json` в root-а capture-ва всеки shared compiler option; всеки package's `tsconfig.json` го extend-ва.

```jsonc
// tsconfig.base.json
{
  "compilerOptions": {
    "strict": true,
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": {
      "@geowealth/e2e-framework": ["./packages/framework/src/index.ts"],
      "@geowealth/e2e-framework/*": ["./packages/framework/src/*"]
    }
  }
}
```

Всеки `tests-<team>/playwright.config.ts` import-ва base config от framework-а и override-ва само това, което е team-specific:

```typescript
// packages/tests-billing-servicing/playwright.config.ts
import { definePlaywrightConfig } from '@geowealth/e2e-framework/config';

export default definePlaywrightConfig({
  projectName: 'billing-servicing',
  testDir: './tests',
  workers: 6,
  use: { storageState: '.auth/billing-servicing.json' },
});
```

`definePlaywrightConfig` в `framework/src/config/playwright.ts` централизира timeouts, retries, reporters, и production safety guard, така че всеки екип наследява същите defaults.

##### 4.2.3.1 Path-Alias капан (Day-1 Footgun)

TypeScript path aliases, декларирани в base `tsconfig.json`, **не** се re-resolve-ват автоматично спрямо extending файл. Те остават anchored към файла, който ги *дефинира* — за `tsconfig.base.json` в workspace root, това е workspace root-а. Две следствия:

1. Ако path alias използва `./packages/framework/src/...` в base config, extending package's `tsc` ще търси този path *под package directory*, не workspace root, и ще fail-не да го разреши.
2. Слагането на `paths` block само в `tsconfig.base.json` следователно не е достатъчно. Всеки package's `tsconfig.json` трябва да **дублира** `paths` block-а (с absolute или правилно anchored paths) за да работят IDE и `tsc` resolution.

Framework-ът ship-ва малък helper в `packages/tooling/src/tsconfig-paths.ts`, който emit-ва правилния `paths` block per package; scaffold script-ът го пише във всеки generated package's tsconfig. Manually edited tsconfigs се lint-ват с custom rule (`local-rules/duplicate-paths-block`), който fail-ва CI ако package's tsconfig липсва block-а.

#### 4.2.3.2 Storage-State Naming Convention

Storage states са role-keyed и per-package, записани в `<package-root>/.auth/<role>.json` (gitignored). Naming правила, enforced от `auth.fixture.ts`:

| Role | Файлов път (в `tests-<team>` package) |
|---|---|
| `tim1` (seed firm-106 advisor) | `.auth/tim1.json` |
| Worker dummy firm admin | `.auth/dummy-admin-<workerIndex>.json` |
| Worker dummy firm advisor | `.auth/dummy-advisor-<workerIndex>.json` |
| GW admin | `.auth/gw-admin.json` |

Framework-ската freshness re-validation handle-ва expiry; stale state file се overwrite-ва на място, никога не се изтрива.

#### 4.2.3.3 Workspace Root Scripts

Workspace root `package.json` излага следните scripts. Per-package scripts се извикват чрез `npm run <script> --workspace=@geowealth/<pkg>`.

| Script | Цел |
|---|---|
| `npm install` | Инсталира всички workspace dependencies и link-ва `workspace:*` packages. |
| `npm run lint` | Lint-ва всеки workspace чрез `eslint`. |
| `npm run typecheck` | Изпълнява `tsc --noEmit` срещу всеки package's tsconfig. |
| `npm run test` | Изпълнява smoke set през всеки populated package, паралелно, чрез per-package matrix. |
| `npm run test:nightly` | Изпълнява пълния regression set през всеки populated package, ползван от nightly job. |
| `npm run scaffold:team -- <args>` | Извиква `packages/tooling/src/scaffold-team.ts`. |
| `npm run scaffold:doctor -- <args>` | Извиква drift detector-а. |
| `npm run check-versions` | Изпълнява single-version enforcement script-а (D-27). |
| `npm run changed-packages` | Принтира affected-package set за текущия diff. |

#### 4.2.4 Self-Service Onboarding — Цел

Една единствена команда произвежда напълно работещ package за нов екип и го регистрира навсякъде, където трябва да бъде регистриран, така че нов екип е продуктивен в рамките на 30 минути от изпълнението. Детайлната спецификация следва.

#### 4.2.5 Спецификация на Scaffold Script-а

Scaffold script-ът е **first-class engineering deliverable**, не one-time helper. Той е owned, tested, versioned, и documented като всяка друга част от framework-а.

##### CLI surface

```bash
# Onboard a brand new team:
npm run scaffold:team -- \
  --name "Reporting" \
  --slug reporting \
  --owner "@reporting-qa-leads" \
  --confluence "https://development.geowealth.com/confluence/display/REP" \
  --testrail-section 412

# Dry run:
npm run scaffold:team -- --name "Reporting" --slug reporting --dry-run

# Validate a previously scaffolded team is still healthy:
npm run scaffold:doctor -- --slug reporting
```

| Flag | Required | Цел |
|---|---|---|
| `--name` | да | Display name; ползва се в README-та, status reports, package descriptions. |
| `--slug` | да | kebab-case identifier; става package directory name и npm package name suffix. Валидиран срещу `/^[a-z][a-z0-9-]+$/`. |
| `--owner` | да | GitHub team handle (e.g. `@geowealth/reporting-qa`); записан в CODEOWNERS. |
| `--confluence` | не | Optional documentation pointer; записан в team package's README. |
| `--testrail-section` | не | Optional TestRail section ID; информира reporter-а в коя section да post-ва results. |
| `--dry-run` | не | Print-ва планираното file tree, излиза без да пише. |
| `--force` | не | Overwrite на съществуващ package — отказва без явно даване. |

##### Какво генерира script-ът

За `--slug reporting`, script-ът произвежда (и проверява не-съществуването на) следните артефакти атомарно — или всички writes succeed-ват или нито един:

| Path | Source | Съдържание |
|---|---|---|
| `packages/tests-reporting/package.json` | template | Name `@geowealth/tests-reporting`, version synced, devDep on framework `workspace:*`. |
| `packages/tests-reporting/playwright.config.ts` | template | Извиква `definePlaywrightConfig({ projectName: 'reporting', ... })`. |
| `packages/tests-reporting/tsconfig.json` | template | Extends `../../tsconfig.base.json`. |
| `packages/tests-reporting/README.md` | template | Попълнен с `--name`, `--owner`, `--confluence`. Включва "first 30 minutes" checklist. |
| `packages/tests-reporting/src/pages/.gitkeep` | template | Празен `src/pages` за team-specific Page Objects. |
| `packages/tests-reporting/tests/smoke/login.spec.ts` | template | Копие на framework's walking-skeleton spec, retagged `@reporting @smoke`. |
| `packages/tests-reporting/tests/regression/.gitkeep` | template | Празно regression tree. |
| `packages/tests-reporting/.auth/.gitignore` | template | Гарантира, че storage states са gitignored локално. |
| `CODEOWNERS` | mutate | Append `packages/tests-reporting/ @geowealth/reporting-qa @geowealth/qa-leads`. |
| `docs/migration-tracker.md` | mutate | Append "Reporting" section header. |
| `.eslintrc.legacy-areas.json` | mutate | Add `packages/tests-reporting` към live (non-legacy) areas list. |
| `.github/workflows/pr-gate.yml` | mutate | Append новия package в CI matrix `package` axis. |
| `.github/workflows/nightly.yml` | mutate | Същото. |
| `package.json` (root) | mutate | (No-op — workspaces wildcard `packages/*` вече match-ва.) |
| `docs/CHANGELOG.md` | append | Един ред: `- Onboarded team package @geowealth/tests-reporting (scaffold v<X>)`. |

След запис, script-ът:
1. Изпълнява `npm install` в workspace root за регистрация на новия package.
2. Изпълнява `npm run lint --workspace=@geowealth/tests-reporting` за валидация на чист compile.
3. Изпълнява `npm run test:smoke --workspace=@geowealth/tests-reporting` срещу конфигурирания `TEST_ENV` за валидация на зеления sample spec.
4. Принтира "Next steps" message: link към `docs/WRITING-TESTS.md`, team's README, и migration tracker section.

##### Success SLA

> Екип, който изпълнява `npm run scaffold:team` срещу clean clone, има зелен smoke spec работещ локално в рамките на **30 минути**, **при положение че developer-ът е изпълнил следните pre-conditions**:
> - Node 20 LTS инсталиран (match-ва `.nvmrc`).
> - Network access до qa2 (или qa3 чрез `TEST_ENV` override).
> - Populated `.env.local` в workspace root с променливите от `.env.example` — най-вече `TIM1_USERNAME` и `TIM1_PASSWORD`. `docs/ONBOARDING.md` водят developer-ите през попълването на `.env.local` от secret store *преди* стартиране на scaffold script-а.
> - Branch `feat/corporate-e2e-migration` (или по-късен) checked out.
>
> 30-минутният clock започва от `npm run scaffold:team` и включва `npm install`, package generation, и пълното изпълнение на smoke spec-а. Ако някоя pre-condition не е изпълнена, script-ът излиза с ясно "missing pre-condition" съобщение и link към `docs/ONBOARDING.md` — не fail-ва тихо по-късно вътре в smoke spec-а.

Този SLA е enforced от **scaffold-test CI workflow** (`.github/workflows/scaffold-test.yml`): на всеки PR, който пипа `packages/tooling/src/scaffold-team.ts`, някой template под `packages/tooling/templates/`, или някой файл, който script-ът mutate-ва, CI:

1. Изпълнява `npm run scaffold:team -- --name "ScaffoldTest" --slug scaffold-test --owner @geowealth/qa-leads`.
2. Изпълнява smoke spec-а на generated package end-to-end.
3. Сравнява wall-clock time с 30-минутния SLA; fail-ва PR-а ако го превиши.
4. Cleans up: трие generated package и revert-ва mutated files в CI workspace-а.

Ако scaffold-test workflow е red, засегнатият PR не може да merge-не. Template rot е невъзможен.

##### Templates

Templates живеят в `packages/tooling/templates/team/` и са валидни TypeScript / JSON / YAML файлове с `{{name}}`, `{{slug}}`, `{{owner}}`, `{{confluence}}`, `{{testrail_section}}` placeholders. Script-ът ползва малък, dependency-free string-replace pass — без Handlebars, без Mustache, за да остане surface-ът минимален и failure modes очевидни.

Template changes се review-ват от QA Automation; scaffold-test workflow е safety net-ът. Добавянето на *нов* artifact в scaffold output е един PR, който update-ва `packages/tooling/src/scaffold-team.ts`, добавя template-а, и изпълнява scaffold-test.

##### `scaffold:doctor` — drift detection

Package на екип може да drift-не с времето като framework-ът еволюира (нови fixtures, нови config keys, нови CI matrix axes). `scaffold:doctor` re-run-ва generation logic-а срещу `--slug` и репортва diff-а между това, което script-ът би генерирал днес, и това, което съществува. Екипите го изпълняват в началото на всеки major framework upgrade. Drift е informational, не failure — но репортът е input-ът за coordinated bring-up-to-date PR.

##### Ownership и versioning

- Script-ът живее в `packages/tooling/src/scaffold-team.ts`, owned от **QA Automation**.
- Templates са versioned чрез monorepo-то single version (Section 6.14 framework SemVer); major bump на templates-ите изисква стартиране на `scaffold:doctor` срещу всеки existing team package и produc-иране на upgrade PR-и.
- Script's CLI е документирано в `docs/SCAFFOLD.md`, само по себе си Phase 1 deliverable.

##### Защо scaffold script-ът е Phase 1 deliverable, не Phase 4

Без script-а, onboarding на втори екип е manual labour. Цялата идея на monorepo-то е новото-team onboarding да е cheap. Преместването на script-а към Phase 1 (веднага след CI bootstrap) означава, че **всеки екип след първия е bootstrap-нат чрез script, не на ръка**. Phase 4 след това exercise-ва scaffold-а през седем реални екипа, което е най-добрата валидация, която можем да направим.

### 4.3 Ключови архитектурни решения

**Lean Page Object Model.**
Page класовете капсулират **selectors и actions само**. Assertions живеят в spec файловете, така че репортите показват meaningful failure context. Reusable React widgets са моделирани като Component classes, consumed от Page classes.

**Layered fixtures (Playwright merge pattern).**
- *Worker scope*: `workerFirm`, `apiClient`.
- *Test scope*: `authenticatedPage` (per role), `testFirm` (когато е нужна fresh firm).
- Композиция: `test = base.extend<AuthFixtures>().extend<DataFixtures>().extend<PageFixtures>()`.

**Three-tier test data стратегия.**
1. **Static seeds** — Firm 106 с `tyler@plimsollfp.com` за read-only тестове (най-бързо).
2. **Worker dummy firm** — за write-path тестове, shared в worker's lifetime.
3. **Per-test firm** — opt-in за тестове, които не толерират никаква state contamination (най-бавно).

**Auth чрез storage state и role matrix.**
`globalSetup` логва веднъж за всяка ключова role (GW admin, firm admin, advisor, client) и persist-ва техните storage states. Fixtures избират правилния state on demand.

**Environment management.**
```typescript
// src/config/environments.ts
export const environments = {
  qa2:   { baseUrl: 'https://qa2.geowealth.com',   ... },
  qa3:   { baseUrl: 'https://qa3.geowealth.com',   ... },
  qatrd: { baseUrl: 'https://qatrd.geowealth.com', ... },
} as const satisfies Record<string, EnvironmentConfig>;
// Selection: TEST_ENV=qa2 npm test
```
Никакви credentials в repo-то. `.env.example` документира expected variables; реалните `.env.<env>` файлове са gitignored. CI инжектира стойности от managed secret store.

**Tagging стратегия.**
- `@smoke` — critical-path сценарии под пет минути общо; работи на всеки commit.
- `@regression` — пълна сюита; работи nightly.
- `@billing`, `@platform-one`, `@pepi` — feature-area tags.
- `@slow` — тестове над 60 секунди; изолирани в dedicated shards.
- `@flaky` — quarantine bucket с controlled retries до stabilize или премахване.

**Reporting.**
Primary: TestRail (запазен от POC). Secondary: HTML report, Git provider annotations, Slack webhook за nightly failures. Optional: Allure, ако екипът поиска trend history.

**CI matrix.**
Sharded execution през 4–8 workers, параметризиран по environment (qa2, qa3) и tag (smoke на всеки PR; regression nightly).

### 4.4 Page Object и Component contracts

**Contract за Page classes.** `Page` клас е тънка façade върху един SPA route или top-level modal.

- *MUST* приема `Page` (Playwright) в constructor-а и излага само методи, които изпълняват user-meaningful actions или връщат locators.
- *MUST NOT* съдържа `expect()` assertions. Assertions остават в spec файловете, така че failure messages mappa-т към user intent.
- *MUST* излага locators като readonly properties, typed `Locator`, именувани по user concept (`saveButton`, `inceptionDateField`), не по implementation (`#btn-2`).
- *SHOULD* композира Component classes за всеки reusable widget вместо да re-implementa selectors inline.
- *MAY* излага `goto()` метод, който вътрешно вика `BasePage.navigateToHashRoute()`.

```typescript
// src/pages/accounts/AccountBillingPage.ts
export class AccountBillingPage extends BasePage {
  readonly editButton: Locator;
  readonly saveButton: Locator;
  readonly inceptionDate: ReactDatePicker;
  readonly historyGrid: AgGrid;

  constructor(page: Page) {
    super(page);
    this.editButton  = page.getByTestId('account-billing-edit');
    this.saveButton  = page.getByTestId('account-billing-save');
    this.inceptionDate = new ReactDatePicker(page, 'inception-date');
    this.historyGrid   = new AgGrid(page, 'billing-history-grid');
  }

  async goto(accountId: string): Promise<void> {
    await this.navigateToHashRoute(`/accounts/${accountId}/billing`);
    await this.editButton.waitFor({ state: 'visible' });
  }

  async openEditModal(): Promise<void> {
    await this.editButton.click();
  }
}
```

**Contract за Component classes.** `Component` обвива един reusable widget (date picker, ComboBox, ag-Grid editor) и се конструира с `Page` плюс stable scope (`testId`, role, или container locator).

- *MUST* е безопасен за многократно instantiate на същата страница.
- *MUST* излага семантични verbs (`select`, `setValue`, `clear`) вместо механични clicks.
- *MUST* вътрешно абсорбира React-hydration races, така че spec authors никога не викат `waitForTimeout`.

### 4.5 Fixture Composition

Framework-ът export-ва един `test` symbol. Spec-овете винаги import-ват от `@/fixtures/base`, никога от `@playwright/test` директно.

```typescript
// src/fixtures/base.ts
import { test as base, mergeTests } from '@playwright/test';
import { authFixtures }    from './auth.fixture';
import { firmFixtures }    from './firm.fixture';
import { apiFixtures }     from './api.fixture';
import { pageFixtures }    from './pages.fixture';

export const test = mergeTests(
  base,
  apiFixtures,
  authFixtures,
  firmFixtures,
  pageFixtures,
);
export { expect } from '@playwright/test';
```

```typescript
// src/fixtures/firm.fixture.ts
type FirmFixtures = {
  workerFirm: ProvisionedFirm;   // worker scope, lazy
  freshFirm:  ProvisionedFirm;   // test scope, opt-in
};

export const firmFixtures = base.extend<{}, FirmFixtures>({
  workerFirm: [async ({ apiClient }, use) => {
    const firm = await apiClient.qa.dummyFirm.create();
    await use(firm);
    // No teardown — accumulating dummy firms is an accepted product behavior.
  }, { scope: 'worker' }],

  freshFirm: async ({ apiClient }, use) => {
    const firm = await apiClient.qa.dummyFirm.create();
    await use(firm);
  },
});
```

Spec-овете opt-in като destructure-ват само fixtures, които им трябват; Playwright's lazy fixture instantiation гарантира, че не работи unused setup.

### 4.6 Typed API Client и Schema Validation

`/qa/*` endpoints не са част от published contract — те еволюират с backend changes. Framework-ът обвива всяко повикване в Zod schema, така че contract drift fail-ва ясно.

```typescript
// src/api/qa/DummyFirmApi.ts
const dummyFirmResponse = z.object({
  firmCd: z.number(),
  firmName: z.string(),
  admin: z.object({ username: z.string(), password: z.string() }),
  advisors: z.array(z.object({ username: z.string(), password: z.string() })),
  households: z.array(z.object({ uuid: z.string(), accounts: z.array(/* ... */) })),
});
export type DummyFirm = z.infer<typeof dummyFirmResponse>;

export class DummyFirmApi {
  constructor(private readonly client: ApiClient) {}
  async create(): Promise<DummyFirm> {
    const raw = await this.client.post('/qa/createDummyFirm.do');
    return dummyFirmResponse.parse(raw);
  }
}
```

Zod failure излага ясна path-and-cause грешка, която е много по-лесна за triage от downstream `undefined.uuid` exception три слоя по-надолу в теста.

### 4.7 Selector стратегия

Selectors се избират по строг priority ladder. Тестовете никога не бива да достигат до по-долните стъпала без обосновка, записана в page object като коментар.

1. **`getByTestId('…')`** — preferred за всеки element под наш контрол. Изисква frontend coordination (Section 6.5).
2. **`getByRole(role, { name })`** — за elements със семантична accessibility (buttons, inputs, headings, dialogs).
3. **`getByLabel('…')`** — за form fields, асоциирани с `<label>`.
4. **`getByText('…', { exact })`** — само за content, който user-ът демонстрируемо чете (headings, status banners).
5. **CSS / XPath** — last resort, ограничено до third-party widgets (ag-Grid Enterprise, react-date-picker), където нито test IDs нито roles са налични. Всеки такъв selector е inline документиран.

### 4.8 Timeouts, Retries и Tracing

| Concern | Политика |
|---|---|
| Default test timeout | 60 s; spec-ове, които искат повече, трябва да викат `test.setTimeout()` и да документират защо. |
| Default action timeout | 15 s. |
| Default navigation timeout | 30 s. |
| Expect timeout | 10 s. |
| Retries | 0 локално; 1 в CI за `@regression`; 2 за `@flaky` (quarantined). Smoke тестове получават **нула** retries — flakes там блокират PR-и. |
| Trace | `on-first-retry` в CI, `retain-on-failure` за smoke. |
| Screenshot | `only-on-failure`. |
| Video | `retain-on-failure`. |
| Hard waits (`waitForTimeout`) | **Banned by ESLint rule** (`playwright/no-wait-for-timeout: error`). Съществуващите usages трябва да се заменят с deterministic waits по време на миграцията. |

### 4.9 Конвенции за писане на тестове

- Един spec файл на TestRail case: `C<id>.spec.ts`. Title format: `@<area> C<id> <human description>`.
- Top-level структура на всеки spec:
  ```typescript
  test('@billing C25193 admin can change inception date', async ({
    accountBillingPage, workerFirm,
  }) => {
    await test.step('Arrange: open billing for fresh account', async () => { /* ... */ });
    await test.step('Act: edit inception date', async () => { /* ... */ });
    await test.step('Assert: change is persisted and audited', async () => { /* ... */ });
  });
  ```
- AAA структура (`Arrange → Act → Assert`) е enforced от code review, не tooling, но `test.step` titles трябва да я отразяват.
- Без conditional control flow вътре в тестове (`if`, `try`/`catch`) освен ако не capture-ва state за по-късна assertion. ESLint Playwright plugin enforce-ва това.
- Magic identifiers (UUIDs, firm codes, usernames) живеят изключително в `src/data/constants/`.

### 4.10 GeoWealth-специфични патърни

Framework-ът трябва да абсорбира няколко quirks на системата под тест, така че spec authors да не ги учат отново всеки път.

#### 4.10.1 Struts `.do` Action contracts

`.do` endpoints не са REST. Те се държат както следва, и API client-ът трябва да handle-ва всеки случай експлицитно.

| Поведение | Implication за client-а |
|---|---|
| Default success: HTTP 200 с JSON body, чиято top-level форма варира per action. | Всеки action има dedicated Zod schema. Няма one-size envelope. |
| Validation failure: HTTP 200 с `{"errors":[…]}` или redirect към server-rendered error page. | Client-ът трябва да check-ва за `errors` преди да parse-ва success schema. |
| Session expiry: HTTP 302 към `/react/loginReact.do`. | Client-ът трябва да детектира redirects и да surface-ва typed `SessionExpiredError` вместо да fail-ва parsing-а. |
| File upload actions: `multipart/form-data`, max 2 GB. | Client-ът излага отделен `postMultipart()` path. |
| Всички actions изискват authenticated session. | API client-ът винаги ползва storage state на role-та, под която е construct-ван. |

#### 4.10.2 React Router v5 Hash Routing

SPA-то ползва **hash-based routing** (`#/login`, `#/advisors`, `#/accounts`). Standard `page.waitForURL()` работи, но predicate-ът трябва да сравнява срещу `page.url()` post-`#`. `BasePage.waitForHashRoute()` централизира това:

```typescript
async waitForHashRoute(pattern: string | RegExp): Promise<void> {
  await this.page.waitForFunction(
    (p) => {
      const hash = window.location.hash.replace(/^#/, '');
      return typeof p === 'string' ? hash === p : new RegExp(p).test(hash);
    },
    typeof pattern === 'string' ? pattern : pattern.source,
  );
}
```

Lazy-loaded modules са чести; navigation трябва да чака за route-а **и** за route-anchor element (heading или top-level container) преди всяко по-нататъшно interaction.

#### 4.10.3 ag-Grid Enterprise

ag-Grid е доминантният data-grid component. Framework-ският `AgGrid` component трябва да обвие следните non-obvious behaviours, документирани в POC tribal knowledge:

- **Virtual scrolling**: rows извън viewport не са в DOM. `getRow(index)` трябва да scroll-ва row-а във view чрез `ensureIndexVisible()`, изложен през `evaluate()` срещу grid API-то.
- **Rich-select editors**: отвори popover, изчакай `.ag-rich-select-list` да е visible, после кликни option-а по accessible text.
- **In-cell editors са double-click activated** за много колони; component-ът трябва да капсулира правилния activation gesture per column type.
- **Column resizing и pinning** могат да променят selectors тихо — component-ът никога не select-ва по visual column index, само по `colId`.
- **Commission Fee combo се отваря само през истински CDP click**, не `Locator.click()` (POC discovery, kept в `project_billing_form_quirks`). Component class-ът трябва да извика `page.mouse.click()` срещу bounding-box coordinates като documented fallback.

#### 4.10.4 Redux и React Query State Awareness

Когато DOM signals не са достатъчни (типично: data е in flight, без spinner), тестовете могат да subscribe-нат към React Query's cache или Redux state чрез `page.evaluate`:

```typescript
// Wait for any in-flight React Query to settle.
await page.waitForFunction(() =>
  (window as any).__REACT_QUERY_CLIENT__?.isFetching() === 0
);
```

Това изисква frontend-ът да изложи `__REACT_QUERY_CLIENT__` на `window` в QA builds (`FOR_QA=true`). Coordination item — виж Section 6.

#### 4.10.5 Multi-Tenant Role Matrix

Всеки spec трябва да декларира както **firm scope**, така и **user role**, които му трябват. Framework-ът осигурява един fixture на комбинация:

| Role | Storage state file | Fixture name | Типична употреба |
|---|---|---|---|
| GW admin | `auth/gw-admin.json` | `gwAdminPage` | Достъп до `/qa/*`, cross-firm operations. |
| Firm admin | `auth/firm-admin.json` (per firm) | `firmAdminPage` | Управление на advisors, firm settings. |
| Advisor | `auth/advisor.json` (per firm) | `advisorPage` | Day-to-day account operations. |
| Client | `auth/client.json` (per firm) | `clientPage` | Client portal flows. |

Storage states за per-firm roles се произвеждат лениво от `workerFirm` fixture-а: provisioning на dummy firm yield-ва нейните admin и advisor credentials, които след това се логват веднъж и се кешират за worker's lifetime.

#### 4.10.6 `data-testid` coverage реалност

Audit на GeoWealth React tree показва по-малко от десет `data-testid` атрибута в цялото SPA, всички концентрирани в unit tests. На практика framework-ът трябва:

1. Да ship-не днес използвайки role/label/CSS стъпалата на selector ladder-а (Section 4.7).
2. Да договори phased `data-testid` rollout с frontend leads, prioritized by feature areas вече в scope за `@regression`.
3. Да track-ва adoption като KPI в Section 9 metrics, така че dependency-то да е visible на leadership.

#### 4.10.7 `/qa/*` Endpoint каталог (test-relevant subset)

Sourced от `src/main/resources/struts-qa.xml`. POC-ът в момента използва само няколко.

| Endpoint | Action class | Use case |
|---|---|---|
| `createDummyFirm.do` | `CommonGwAdminQaAction` | Provision на изолирана firm + admin + advisors + accounts. **Foundation на worker isolation.** |
| `createInvitationToken.do` | `UserInvitationTokenQAAction` | Генериране на onboarding/invitation links. Изисква се за Auto-link suite. |
| `invalidateToken.do` | `UserInvitationTokenQAAction` | Revoke на tokens. |
| `importCustodianAccount.do` | `ImportCustodianCommonAction` | Seed на custodian accounts на firm. |
| `createCrntCostBasis*.do` | `CreateCrntCostBasisQAAction` | Seed cost-basis lots, daily finalization, gain/loss. |
| `executeMFs.do` | `ExecuteMFQAAction` | Симулира mutual-fund order execution. |
| `simulateSchwabTransaction.do` | `TradingMiscellaneousQAAction` | Mock на Schwab broker activity. |
| `uploadTPAMFile.do` | `TradingMiscellaneousQAAction` | Test file uploads през trading pipeline. |
| `createChildServiceRequests.do` | `ServiceRequestToolsAction` | Seed на service request workflows. |
| `runTestReports.do` | `ReportsTestToolsAction` | Trigger на reporting pipeline. |

Framework's `src/api/qa/` directory трябва да расте с typed wrapper за всеки endpoint *преди* първия consumer test, така че знание не regress-ва тихо обратно в spec файлове.

> ⚠️ Всички `/qa/*` actions са gated от `CommonGwAdminQaAction.canExecuteAction()` (GW admin role). Те са **достъпни на production**, както и на QA — framework's API client трябва да отказва да вика който и да е `/qa/*` endpoint, когато конфигурираната среда е `production`.

---

## 5. Операции

Тази секция дефинира как framework-ът работи ден за ден: pipelines, secrets, observability, ownership, и failure-handling протоколите, които държат сюитата надеждна.

### 5.1 Pipeline Topology

| Pipeline | Trigger | Scope | Target duration | Failure policy |
|---|---|---|---|---|
| **PR gate** | PR open / push | Само `@smoke`, срещу target environment-а на PR-а | ≤ 8 минути wall clock | Всеки failure блокира merge. Нула retries. |
| **Nightly regression** | Cron `0 22 * * *` UTC (полунощ CET, 17:00 US Eastern, 01:00 EET — покрива сутринта на QA екипа и предишния следобед на US екипа) | `@regression` без `@flaky`, срещу qa2 *и* qa3 паралелно | ≤ 60 минути per environment | Failures отварят auto-triage tickets и постват в `#qa-alerts`. |
| **Quarantine** | Cron `0 0 * * *` UTC (два часа след nightly regression) | Само `@flaky` | Best-effort | Резултатите информират weekly stabilization review; никога не блокира нищо. |
| **On-demand** | Manual dispatch (env + tag inputs) | Caller-defined | Caller-defined | Резултатите visible за caller-а, не post-нати в alerting. |
| **Release verification** | Тригърнато от deploy webhook | `@smoke + @journey`, срещу deployed environment | ≤ 15 минути | Failure rolls back deploy-а през deploy pipeline. |

### 5.2 Sharding и паралелизация

- Workers per shard: **6** (валидирано от POC под qa2/qa3 load).
- Shards per environment: **4** за nightly regression → effective parallelism 24.
- Shard distribution: by spec file (Playwright's default), не by project, така че duration balancing е автоматично.
- Per-environment quota: nightly regression не трябва да консумира повече от **40 worker-minutes per environment**, за да остане headroom за ad-hoc developer runs.
- Hard cap: един спец, надхвърлящ **5 минути**, трябва да носи `@slow` tag и да е сегрегиран в собствен shard.

### 5.3 Secrets и Credential Management

| Secret | Storage | Injection | Rotation |
|---|---|---|---|
| `TIM1_PASSWORD`, role passwords за shared seed users | CI secret store (native vault на избраната платформа) | Environment variables в началото на job-а; никога не се пишат на диск освен като `.env.<env>.local` в runner sandbox. | Тримесечно, координирано с GeoWealth security екипа. |
| `TESTRAIL_USER`, `TESTRAIL_API_KEY` | CI secret store | Същото | Годишно, или при team membership change. |
| `/qa/*` admin credentials | CI secret store, отделен scope | Същото | Тримесечно. |
| Local developer credentials | Personal `.env.<env>.local` (gitignored) | Loaded by `dotenv-flow` | Лична отговорност. |

Hardcoded credentials в `testrail.config.json` (текущо POC състояние) се премахват в Phase 3 на миграцията. Файлът става config-only и пътува във version control без никакъв secret material.

Framework-ът включва pre-commit hook (`detect-secrets` или еквивалент), който fail-ва commits, въвеждащи high-entropy strings в tracked files.

### 5.4 Branch Protection и Quality Gates

Required checks на default branch на framework repo-то:

1. **Lint** — ESLint + Prettier, нула warnings.
2. **Type check** — `tsc --noEmit`, нула errors.
3. **PR gate pipeline** — `@smoke` зелен на поне една среда.
4. **Coverage of changed Page Objects** — всеки нов Page Object class трябва да е exercised от поне един спец в същия PR.
5. **Без добавени skipped specs** — `test.skip` и `test.fixme` въвеждания изискват явен `// QA-ARCH-001:waived <ticket>` коментар, enforced от custom ESLint rule.
6. **Двама reviewers**: един QA, един engineer от owning team на feature-а (per Section 5.7 ownership map).

### 5.5 Observability

| Сигнал | Къде каца | Retention |
|---|---|---|
| Playwright HTML report | CI artifact | 14 дни |
| Playwright trace (`.zip`) | CI artifact, само на failure или first retry | 14 дни |
| Screenshots и videos | CI artifact, на failure | 14 дни |
| TestRail results | TestRail | Permanent |
| Structured run metadata (env, sha, duration, pass/fail counts) | Time-series store (Prometheus push gateway, Datadog, или еквивалент — TBD) | 1 година |
| Slack notifications | `#qa-alerts` (failures), `#qa-trends` (weekly summary) | Slack default |

Framework-ът emit-ва финален JSON summary per run (`run-summary.json`), който CI uploader-ът forward-ва към time-series store-а. Това отблокира KPI-те в Section 9.

### 5.6 Flake Management

- **Дефиниция.** Spec е `@flaky` когато fail-ва недетерминистично повече от веднъж в който и да е rolling 14-day window без асоциирана product change.
- **Quarantine SLA.** В рамките на 24 часа от identified flake, спецът е tagged `@flaky` и вече не gate-ва PR-и.
- **Stabilization SLA.** Quarantined спецове трябва да са или fixed, rewritten, или deleted в рамките на **10 working days**. Owning team се нотифицира на дни 3, 7 и 10.
- **Flake budget.** Aggregate `@regression` flake rate трябва да остане под **2%** week over week. Прекрачването на budget-а замразява нови test additions, докато rate-ът се възстанови.
- **Triage automation.** Nightly failures се clustered by failure signature; clusters с три или повече occurrences за седем дни се auto-tagged `@flaky` за human review.

### 5.7 Ownership и RACI

| Concern | Responsible | Accountable | Consulted | Informed |
|---|---|---|---|---|
| Framework core (`src/`) | QA Automation | QA Lead | Engineering, Platform | Цялото engineering |
| Spec correctness per feature area | QA контакт на feature екипа | Feature team lead | QA Automation | Product |
| `data-testid` adoption | Frontend leads | Frontend team lead | QA Automation | QA Lead |
| `/qa/*` endpoint stability | Backend екипът, owning each action | Backend team lead | QA Automation | QA Lead |
| Environment health (qa2, qa3, qatrd) | Platform / DevOps | Platform lead | QA Automation | Всички екипи |
| Secret rotation | Security | Security lead | QA Automation | QA Lead |
| TestRail integration | QA Automation | QA Lead | — | Product |

`CODEOWNERS` файл в framework repo-то енкодва тази карта за PR review routing.

### 5.8 Test Data Lifecycle

- **Dummy firms се натрупват by design** (POC решение, запазено). Framework-ът не ги изтрива.
- **Audit cadence.** Тримесечно ревю с Platform екипа за потвърждаване, че dummy firm growth не impact-ва environment performance.
- **Naming.** Всички firms, създадени от framework-а, носят `e2e-` name prefix и creation timestamp, така че manual cleanup остава възможен ако някога е нужен.
- **Static seed protection.** Firm 106 и `tyler@plimsollfp.com` са reference data. Framework's API client отказва да мутира някой от тях, когато спец не е явно tagged `@phase-2-readonly`.

### 5.9 Environment Health Pre-flight

Преди всеки nightly run да започне, **pre-flight job** проверява:

1. **Target environment-ът е достъпен.** `GET /` срещу base URL връща в рамките на 5 секунди. (Предишният "GET /react/loginReact.do" беше грешен — този endpoint очаква POST и bare GET връща login form, което би маскирало auth failures.)
2. **`tim1` може да се auth-не end-to-end.** Pre-flight изпълнява реален `POST /react/loginReact.do` с credentials и assert-ва, че response set-ва session cookie и redirect-ва към `#/dashboard` или еквивалент. Това е единствената проверка, която доказва, че env-ът е *реално използваем*.
3. **`/qa/createDummyFirm.do` връща в рамките на 30 секунди** (с GW-admin storage state attached).
4. **Internal Confluence link за QA documentation е достъпен** (best-effort, non-blocking).

Pre-flight failures abort-ват run-а с ясна environment-health грешка вместо стотици объркващи spec failures, и on-call Platform engineer-а получава page.

**Transient-degradation caveat.** Pre-flight работи веднъж в *началото* на nightly. Ако средата деградира след като pre-flight passes, но преди спецовете да приключат, останалата част от run-а продължава срещу нездрава среда. Това е intentional: pre-flight хваща durable degradation, не transient flicker. Spec-level retries (Section 4.8) и flake budget-ът (Section 5.6) абсорбират transient blips. Не оспорвай това в incident retros — trade-off-ът е документиран.

**Manual override.** Decision D-23 / Section 6.9: on-call QA engineer може да set-не `SKIP_PREFLIGHT=1`, за да форсира run, когато pre-flight има известна false positive. Override-ът е audit-нат в `run-summary.json` и тригърва follow-up issue срещу pre-flight, ако е ползван два пъти в който и да е rolling 7-day window.

---

## 6. Migration Plan

Миграцията е **incremental и неразрушителна**. Съществуващият POC продължава да доставя TestRail Run 175 резултати през целия преход; legacy спецове се изтеглят само след като техните replacements удовлетворят документиран parity gate.

### 6.1 Водещи принципи

1. **Security first.** Committed credentials са Critical-severity finding (Section 2.2) и се решават в Phase 0, не накрая.
2. **CI before content.** Continuous validation трябва да съществува, преди първият migrated спец да кацне, така че quality да е enforced от първия commit, не retrofitted.
3. **Walking skeleton, then breadth.** Phase 0 завършва с най-малкия възможен vertical slice, който exercise-ва всеки architectural слой end-to-end.
4. **Parity gate before deletion.** Legacy спецове се изтриват само след като техните replacements работят зелени за **пет последователни nightly runs** на target environment-а.
5. **POC freeze.** Веднъж щом миграцията влезе в feature-area работа, не се добавят нови тестове в legacy `tests/<feature>/` директории — само bug fixes и stabilization.
6. **Един feature area in flight в даден момент.** Concurrent миграция на multiple areas умножава risk и review burden; sequence-вайте ги.

### 6.2 Phase 0 — Foundation & Security Hotfix

**Цел.** Направи repo-то безопасно и положи TypeScript foundation. Завърши с един trivial smoke spec, работещ локално под новата архитектура.

**Технически предусловия (version pins, recorded като decision D-19).**

| Tool | Pinned version | Защо |
|---|---|---|
| Node.js | `20.x LTS` (declared в `package.json` `engines` и `.nvmrc`) | Match-ва Playwright 1.47 baseline; LTS lifecycle до 2026-04. |
| `@playwright/test` | `~1.47.0` | POC baseline; `mergeTests` е stable от 1.45 нататък. |
| TypeScript | `~5.5` | Изисква се за Playwright 1.47 type compatibility. |
| Zod | `~3.23` | Last stable 3.x; pinned за избягване на 4.x breaking changes. |
| `dotenv-flow` | `~4.1` | CJS-compatible; верифицирано срещу Playwright's loader. |
| ESLint | `~10.2` (match-ва POC) | Избягва lockfile churn; POC-ът вече работи ESLint 10. |

`package-lock.json` се commit-ва; CI ползва изключително `npm ci`. Без floating ranges.

**Scope (изпълнен в този строг ред — всяка стъпка е един PR или един logical PR cluster, и POC nightly се verify-ва зелен на всяка step boundary).**

Двете cardinal rules:
- **Rule 1:** *Никога не смесвай relocation с content change в същия commit.* Moves са pure renames; refactors се случват на новия path.
- **Rule 2:** *Foundational layer-ът на framework-а (auth fixture, globalSetup, `definePlaywrightConfig`) се build-ва **преди** bootstrap consumer-ът да има нужда от него.* Phase 0 build-ва функционален `packages/framework/` — той не е "empty until Phase 2".

*Step 0.0 — Walking-skeleton selector reconnaissance (трябва да приключи преди Step 0.A да започне).*
- Logvai се ръчно в qa2 като `tim1` и инспектирай dashboard DOM. **Идентифицирай точния accessible-name selector**, срещу който walking skeleton ще assert-ва. Запиши избрания selector — неговия tag, role, accessible name, и context на element-а — в Phase 0 tracking issue. Без това, Step 0.F's walking-skeleton spec е сляпо предположение и ще fail-не на ден едно.
- Selector-ът трябва да е reachable през role/label/text стъпалата на Playwright (Section 4.7); CSS-only fallbacks се записват като risk и се re-attempt-ват след първия `data-testid` rollout в Phase 3.
- Тази 30-минутна reconnaissance е най-евтината възможна insurance срещу Phase 0 demo failure.

*Step 0.A — Workspace bootstrap (без POC промени все още).*
- Инициализирай npm workspace в repo root: workspace `package.json` с `"workspaces": ["packages/*"]`, `engines.node = "20.x"`, pinned dependency блока (D-19), `tsconfig.base.json`, root `.gitignore`, **един workspace-root `eslint.config.mjs` flat config** (D-38), който абсорбира съдържанието на съществуващия POC `eslint.config.mjs` и добавя per-package overrides за новите packages, `.nvmrc`, `.env.example`, `CODEOWNERS` (initially празен за legacy paths) с structured section markers (Section 6.11), `.eslintrc.legacy-areas.json` (празен array), `docs/CHANGELOG.md` (initialized с `0.1.0` heading), `docs/SCAFFOLD.md` (placeholder, обясняващ че templates съществуват, full content в Phase 1).
- `tsconfig.base.json` е конфигуриран per Section 4.2.3, с **path-alias caveat от Section 4.2.3.1 явно приложено** — paths се дублират във всеки extending `tsconfig.json`, не се наследяват.
- Създай четирите package skeletons като empty directories с валидни `package.json` файлове само (без source code все още): `packages/framework/`, `packages/tooling/`, `packages/legacy-poc/`, `packages/tests-billing-servicing/`. Framework's `src/index.ts` **не** се създава в Step 0.A — той каца в Step 0.F като реален public-surface re-export, defined от D-36. Step 0.A's tsc walk ползва empty directory-то като input. Шестте други team packages (`tests-platform`, `tests-trading`, `tests-reporting`, `tests-investments`, `tests-integrations`, `tests-custody-pa`) **не** се създават в Step 0.A — те се генерират от scaffold script-а в Phase 1 от known-good template.
- Verify че `npm install` в root produce-ва clean lockfile и `tsc -p packages/framework/tsconfig.json --noEmit` succeed-ва срещу empty skeleton-а.
- POC-ът в repo root **не се пипа** в Step 0.A. Продължава да работи от `tests/`, `reporters/`, `playwright.config.js` точно както преди.

*Step 0.B — POC relocation (pure rename, single PR).*
- Премести съществуващия POC в `packages/legacy-poc/` като **pure rename**: `tests/` → `packages/legacy-poc/tests/`, `reporters/` → `packages/legacy-poc/reporters/`, `playwright.config.js` → `packages/legacy-poc/playwright.config.js` (все още `.js`, **не renamed към `.ts`** — виж decision D-31), `scripts/` → `packages/legacy-poc/scripts/`, `testrail.config.json` → `packages/legacy-poc/testrail.config.json`. Legacy `eslint.config.mjs` **не** се мести — правилата му бяха merge-нати в workspace root config в Step 0.A (D-38).
- `package.json` и `package-lock.json` в root се *заменят* (не се местят) от workspace root файловете от Step 0.A. **Legacy-poc hoist policy (D-43):** `packages/legacy-poc/package.json` декларира **само** dependencies, които divergent-ват от workspace root pin (днес: никакви — legacy POC и framework target-ват същата Playwright version). Всички shared dependencies са hoisted от root-а. Това избягва dual-dependency drift; единичният lockfile в workspace root е авторитетен. Ако legacy POC някога има нужда от divergent version, декларирай я явно в `packages/legacy-poc/package.json` и приеми duplication-а за тази една dep.
- Relocation PR-ът съдържа **само** moves и новия `legacy-poc/package.json`. Без source-code edits. `git mv` запазва history-то.
- Verify POC nightly работи зелено от `packages/legacy-poc/` чрез `npm run test --workspace=@geowealth/legacy-poc`. Ако не работи, PR-ът се revert-ва и relocation strategy се re-examine-ва преди по-нататъшна работа.

*Step 0.C — POC env-var refactor (на новата локация).*
- **Inventory first.** Изпълни `grep -rn "testrail.config" packages/legacy-poc/` и produce list на всяка референция. POC-ът има поне пет файла, четящи `testrail.config.json` (`reporters/testrail-reporter.js`, `playwright.config.js`, `tests/_helpers/global-setup.js`, `tests/_helpers/qa3.js`, `tests/_helpers/worker-firm.js`); inventory-то се записва в Phase 0 tracking issue.
- Refactor всяка референция да чете от `process.env`. Стойностите в `packages/legacy-poc/testrail.config.json` се местят временно в workspace-root `.env.local` (gitignored), а JSON файлът става secret-free.
- Verify POC nightly зелено от новата локация със стари credentials преди Step 0.D.

*Step 0.D — Credential rotation (с sandbox dry-run първо).*
- **Dry-run first** срещу throwaway TestRail user и throwaway GeoWealth dummy admin per dry-run requirement в Section 6.14. Dry-run-ът валидира, че (а) env-var refactor-ът достига всяка референция, (б) secret-store handoff работи end-to-end, (в) rollback path-ът е exercised.
- Координирай се с named Security counterpart (D-22), за да rotate-неш всеки credential, който е бил преди committed. Третирай старите стойности като компрометирани.
- Update secret store-а и `.env.local` на всеки developer в lockstep с rotation-а.
- Verify POC nightly зелено в рамките на 24 часа от rotation-а; ако не — restore от secret store и root-cause-вай преди да продължиш.

*Step 0.E — Git history audit и rewrite-vs-accept decision.*
- Добави `detect-secrets` като workspace devDependency на Phase 0 entry. Wire-ни го в `husky` (или еквивалент) **pre-commit hook** в `packages/tooling/scripts/pre-commit-secrets.sh`; hook-ът fail-ва всеки commit, който въвежда high-entropy string в tracked file. Hook-ът се commit-ва в Step 0.A като част от workspace bootstrap, *преди* всяка rotation работа да започне.
- Изпълни `detect-secrets scan --all-files` срещу working tree и `git log --all -p | detect-secrets scan` срещу history-то. Produce report.
- **Binary решение записано като D-20**, owned от Security: *rewrite history* (`git filter-repo`, force-push, всеки clone re-clones) или *формално приемане* на историческата експозиция (rotated credentials вече не са валидни, така че leak-ът е безвреден занапред). Планът не pre-decide-ва.
- Ако rewrite е избран: schedule за известен quiet window; нотифицирай всеки developer за re-clone; update Confluence space-а с новия HEAD SHA.

*Step 0.F — Framework foundational layer (минимумът за walking skeleton).*
- Build framework's *foundational* surface само — не пълната Component library, не пълния API client. Phase 0's framework deliverables са точно това, което walking skeleton-ът трябва да consume:
  - `packages/framework/src/config/environments.ts` — typed environment definitions, покриващи qa2, qa3, qatrd.
  - `packages/framework/src/config/playwright.ts` — exports `definePlaywrightConfig(opts)`. **В Phase 0 reporter list-ът е просто `[['list'], ['html', { open: 'never' }]]`** — framework-ският TS TestRail reporter още не съществува (Phase 1 deliverable). `definePlaywrightConfig` чете env var `TESTRAIL_REPORTING=on` и *условно* добавя TestRail reporter само когато е present.
  - `packages/framework/src/config/dotenv-loader.ts` — `dotenv-flow` wrapper, който resolve-ва `.env.<env>.local` от workspace root.
  - `packages/framework/src/fixtures/globalSetup.ts` — логва `tim1` веднъж per execution и пише storage state.
  - `packages/framework/src/fixtures/auth.fixture.ts` — exposes `authenticatedPage` per role, със **storage-state freshness re-validation**. Проверката работи **веднъж per worker per execution**, не per test, четейки `mtime` на storage-state файла. Само когато cached state е потенциално stale, fixture-ът прави реален authenticated request; 302 към login триггърва re-login и rewrite на файла. Това bound-ва extra HTTP volume до **N workers per nightly**, не N × tests, и предпазва qa2 от unnecessary login pressure (R-15 / Section 6.2 Step 0.H).
  - `packages/framework/src/fixtures/base.ts` — composed `test` и `expect` exports, които всеки spec import-ва.
  - `packages/framework/src/index.ts` — public surface re-export.
  - `packages/framework/package.json` — name `@geowealth/e2e-framework`, version synced, и явен **`exports` field** (D-36).
  - `packages/framework/tsconfig.json` — extends `../../tsconfig.base.json` *с paths block дублиран локално* (Section 4.2.3.1).
- Framework-ският TestRail reporter, пълната Component library, пълния API client, factories и types са deferred to Phase 2.

*Step 0.G — Scaffold templates first, bootstrap billing-servicing от тях.*
- **Step 0.G.1 — Substitution function first.** Преди template-и да са authored или package generated, напиши `packages/tooling/src/substitute.ts` exporting една pure функция `substitute(template: string, vars: Record<string, string>): string`. Това е **единственият substitution mechanism**, ползван и от ръчното Phase 0 expansion и от бъдещия Phase 1 scaffold script. Двама callers, една имплементация, drift невъзможен.
- **Step 0.G.2 — Author the templates** в `packages/tooling/templates/team/`: `package.json.tpl`, `tsconfig.json.tpl`, `playwright.config.ts.tpl`, `README.md.tpl`, `tests/smoke/dashboard.spec.ts.tpl` (named **`dashboard.spec.ts` not `login.spec.ts`** за да няма collision с future team smoke specs), `tests/regression/.gitkeep.tpl`, `src/pages/.gitkeep.tpl`, `.auth/.gitignore.tpl`, `.gitignore.tpl`.
- **Step 0.G.3 — Generate the bootstrap.** Tiny Node script `packages/tooling/scripts/expand-templates.ts` чете всеки template, вика `substitute` със `slug=billing-servicing`, и пише output-а под `packages/tests-billing-servicing/`.
- **Step 0.G.4 — Verify parity.** `packages/tooling/scripts/verify-bootstrap-vs-templates.ts` re-run-ва `substitute` върху template-ите и diff-ва срещу on-disk файловете. Скриптът работи в CI на всеки PR, който пипа templates, bootstrap, или substitute функцията, и fail-ва ако който и да е байт се различава. **Това елиминира D-34's drift проблем на ден едно.**
- **Walking-skeleton naming-collision policy:** walking-skeleton spec-ът е `dashboard.spec.ts`, не `login.spec.ts`. Когато екипи добавят свои smoke specs (`login.spec.ts`, `home.spec.ts`, и т.н.), не е възможна collision. Scaffold script-ът отказва overwrite без `--force`.
- **Login pressure през седем team packages.** Дори с distinct spec names, всеки per-team smoke nightly логва `tim1`. Framework's `auth.fixture.ts` пише storage state-а в **workspace-root** `.auth/tim1.json` (D-41), така че всеки team package споделя един файл и един login per nightly, не седем.
- Walking-skeleton spec-ът consume-ва framework-ския `authenticatedPage` fixture и assert-ва `getByRole('heading', { name: /dashboard/i })`. **Inline login е забранен**, така че бъдещите spec authors копират правилния pattern.

*Step 0.H — Confluence, tracking, и target environment.*
- Създай Confluence space за living documentation; link-ни този proposal като първа страница.
- Отвори Phase 0 tracking issue с exit-criteria checklist отдолу.
- Set `TEST_ENV=qa2` като default за walking skeleton. **qa2 stability fallback (D-23):** ако qa2 е unhealthy за две последователни Phase 0 нощи, switch към qa3 чрез `TEST_ENV=qa3` и escalate qa2 към Platform.

**Deliverables.**
- Workspace root: `package.json` с workspaces и Node 20, `package-lock.json`, `tsconfig.base.json`, `.env.example`, `.nvmrc`, `CODEOWNERS`, `.eslintrc.legacy-areas.json`.
- `packages/legacy-poc/` съдържащ предишния POC, nightly зелено от новата локация.
- `packages/framework/` empty skeleton (`@geowealth/e2e-framework`).
- `packages/tooling/` empty skeleton (`@geowealth/e2e-tooling`).
- `packages/tests-billing-servicing/` bootstrap consumer, generated от templates per D-34.
- POC refactored да чете credentials от env vars; nightly зелено и преди и след rotation.
- Storage-state freshness re-validation в `auth.fixture.ts`.
- `docs/adr/` directory с `0000-template.md`; ADR-0001 (Phase 4 ordering rationale) и ADR-0002 (monorepo with npm workspaces).
- `docs/status-report-template.md`, `docs/phase-verifications/`, `docs/migration-tracker.md` (само header), `docs/RETROSPECTIVE.md` template.
- `docs/SCAFFOLD.md` placeholder.
- Confluence space създадено.
- Security-rotation sign-off recorded срещу **D-11**; history-rewrite decision recorded като **D-20**.
- Repo tagged `v0.1.0` на Phase 0 exit.

**Exit criteria.**
- [ ] Нула committed secrets верифицирано от `detect-secrets` срещу working tree и последните 100 commits.
- [ ] `npm run lint`, `tsc --noEmit`, и walking-skeleton spec всички зелени локално.
- [ ] Existing legacy POC спецове все още минават unchanged (`allowJs` regression check).
- [ ] Security е потвърдил credential rotation в писмен вид.

**Dependencies resolved by entry:** D-01 (TypeScript), D-04 (repo topology), D-07 (run-175 cadence).

---

### 6.3 Phase 1 — CI Bootstrap, Per-Package Matrix, и Scaffold Script

**Цел.** Изправи CI platform-ата с per-package matrix support, ship-ни scaffold script-а като first-class deliverable, и осигури всяка следваща промяна към който и да е package да е continuously validated.

**Phase 1 size note.** Phase 1 беше преди sized M (CI bootstrap само). Със scaffold script, affected-detection plumbing-а, TestRail reporter port, и per-package CI matrix всички в scope, **Phase 1 е re-sized to L** (D-29). Planned relative duration е 2–3 working weeks.

**Scope.**
- Provision избраната CI platform (D-02) и secret store namespace (D-03).
- Имплементирай **PR gate** pipeline (Section 5.1) с **per-package affected detection**. Lint и type-check цялото workspace; изпълнявай smoke specs само за packages, чийто source (или framework dependencies) е променен в PR-а.
- Имплементирай **nightly regression** pipeline shell със същата per-package matrix; матрицата се генерира динамично, така че добавянето на нов team package през scaffold script автоматично разширява матрицата без CI edits.
- Имплементирай **environment health pre-flight** (Section 5.9) и gate nightly runs върху него.
- Port TestRail reporter-а към TypeScript в `packages/framework/src/reporters/testrail-reporter.ts`; валидирай срещу *отделен* TestRail sandbox run. **TS reporter-ът никога не сочи към Run 175, докато JS reporter-ът също сочи към него** — два reporters, пишещи към същия run, продуцират interleaved, противоречиви резултати. Cutover-ът от JS-on-Run-175 към TS-on-Run-175 е atomic, single-PR, и се случва в момента на POC sunset (Phase 5).
- Wire `run-summary.json` emission per-package и (best-effort) push към time-series store.
- Установи branch protection per Section 5.4, включително per-package CODEOWNERS.
- **Build the scaffold script** в `packages/tooling/src/scaffold-team.ts` per Section 4.2.5. Author всички templates в `packages/tooling/templates/team/` (re-using тези от Phase 0 Step G). Имплементирай `scaffold:doctor`. Добави **scaffold-test workflow**, който изпълнява script-а end-to-end на всеки PR, пипащ templates, и валидира 30-минутния SLA — със secrets-injection contract отдолу.
- Author `docs/SCAFFOLD.md`.
- **Scaffold the six empty team packages.** Веднъж щом script-ът е зелен през scaffold-test workflow, изпълни го шест пъти за platform, trading, reporting, investments, integrations, custody-pa.

**Affected-package detection (`scripts/changed-packages.ts`).** Scriptът е реална работа, не handwave. Имплементиран в TypeScript под `packages/tooling/src/changed-packages.ts` и exposed на CI чрез thin shell wrapper в `scripts/changed-packages.sh`. Алгоритъм:

1. Изчисли changed file set: `git diff --name-only "$BASE_SHA" HEAD`.
2. Mappa всеки changed file към owning workspace package, walking up до най-близкия `package.json`. Файлове извън `packages/` тригърват **"all packages" fallback**.
3. Build workspace dependency graph четейки всеки `packages/*/package.json`'s `dependencies` и `devDependencies` за `workspace:*` references.
4. Изчисли **transitive closure** на dependents за всеки directly-affected package.
5. Emit JSON към stdout: `{"packages": ["@geowealth/framework", "@geowealth/tests-billing-servicing", ...]}`.
6. CI matrix consume-ва този JSON през `scripts/ci-matrix.ts` и produce-ва per-shard job spec.

Скриптът има **собствени unit tests** в `packages/tooling/tests/changed-packages.test.ts`.

**Multi-package CI invocation.** Всеки package owner-ва свой `playwright.config.ts` (или `playwright.config.js` за `legacy-poc`). CI ги invoke-ва per-package с `npm run test --workspace=<pkg>`. Няма top-level `playwright.config.ts`, който агрегира multiple packages.

**TestRail aggregation across packages (D-30).** Per-package nightly runs всеки emit-ват свой TestRail payload. За избягване на race conditions на TestRail's `add_results_for_cases`, per-package reporters пишат в **per-package result files** под `<package-root>/test-results/testrail-results.json`, и един **post-processing job** в края на nightly агрегира всички per-package result files и POST-ва към TestRail Run 175 в **един** call. Post-processing job-ът живее в `packages/tooling/src/testrail-aggregator.ts`.

**Single-version enforcement (D-27).** Pre-commit hook и CI lint check изпълняват `packages/tooling/src/check-versions.ts`, който чете всеки `packages/*/package.json` и workspace root, assert-ва че `version` е identical, и fail-ва commit / PR ако не.

**Scaffold-test secrets-injection contract.**

1. CI passes `TIM1_USERNAME`, `TIM1_PASSWORD`, и `TEST_ENV` като job-level env vars от secret store.
2. Generated package-ът чете тях през `process.env` чрез framework's `dotenv-loader`. **Няма** `.env.local` файл в CI; `dotenv-flow` fall through-ва към `process.env`.
3. След като smoke spec-ът завърши, workflow-ът трие generated package, revert-ва CODEOWNERS / migration tracker / `.eslintrc.legacy-areas.json` / CI matrix mutations, и излиза с exit code на smoke spec-а.
4. Cleanup работи в `if: always()`.
5. Workflow-ът работи в isolated runner — никога на self-hosted runner.

**Deliverables.**
- CI workflow files (`.github/workflows/pr-gate.yml`, `nightly.yml`, `scaffold-test.yml`).
- Per-package CI matrix.
- `packages/tooling/src/changed-packages.ts` (с unit tests).
- `packages/tooling/src/ci-matrix.ts`.
- `packages/framework/src/reporters/testrail-reporter.ts` валидиран срещу sandbox run.
- `packages/tooling/src/testrail-aggregator.ts`.
- `packages/tooling/src/check-versions.ts`.
- Pre-flight health-check script под `packages/tooling/src/preflight.ts`.
- Branch-protection rules; per-package CODEOWNERS със structured section markers.
- `run-summary.json` artifact per package.
- `packages/tooling/src/scaffold-team.ts` + templates + `docs/SCAFFOLD.md`.
- Scaffold-test workflow зелен; SLA budget enforced.

**Exit criteria.**
- [ ] PR gate работи на всеки PR под 8 минути за smallest affected matrix; failure блокира merge. **Scaffold-test работи в parallel job, не в series с gate-а.**
- [ ] Nightly regression работи срещу qa2 *и* qa3 паралелно за всеки populated package, включително framework-ския собствен component smoke specs.
- [ ] Pre-flight abort-ва nightly чисто когато среда е unhealthy.
- [ ] TestRail reporter post-ва results от новия pipeline към dedicated migration sandbox run за **поне 5 последователни нощи** с **logically equivalent** payloads. Run 175 untouched до Phase 5 sunset.
- [ ] TestRail aggregator (`testrail-aggregator.ts`) verified да produce-ва един POST per nightly.
- [ ] Single-version enforcement script хваща deliberately-misversioned package в CI test.
- [ ] Branch protection enforce-ва lint + type check + PR gate per package.
- [ ] **Scaffold script е зелен:** scaffold-test workflow honors secrets-injection contract.
- [ ] **Шестте други team packages съществуват**, всеки със зелен smoke spec работещ nightly.
- [ ] **M3 milestone met** (Section 6.15): named втори QA contributor committed за поне 50% от времето си.

**Dependencies resolved by entry:** D-02 (CI platform), D-03 (secret store).

---

### 6.4 Phase 2 — Component Library, API Client, и документация

**Цел.** Build the reusable substrate, върху който всички feature-area миграции ще зависят, и produce документацията, която нови contributors ще четат първа.

**Scope.**
- **Phase 2 entry spike (задължително преди да се lift-не helper):** scope легендарния `packages/legacy-poc/tests/account-billing/C25193.spec.js` end-to-end. Produce one-page note в Phase 2 tracking issue, изброяващо всеки helper модул, който import-ва, всеки magic identifier, и всеки product quirk, който заобикаля. Тази spike е input към C25193 graduation effort и предотвратява "L sized but actually XL" risk-а, recorded срещу R-12.
- **Component rewrite, не lift.** Per D-35 (no shim), legacy POC държи своите JS helpers недокоснати. Phase 2 build-ва **нови TypeScript Component classes** под `packages/framework/src/components/*.ts` (`ReactDatePicker`, `ComboBox`, `AgGrid`, `NumericInput`, `TypeAhead`), използвайки legacy `packages/legacy-poc/tests/_helpers/ui.js` като *behavioural reference*, не source migration. Framework Components и legacy helpers работят side by side — legacy POC consume-ва само JS, новите тестове consume-ват само TS. Всеки нов Component се валидира от собствения си framework smoke spec; legacy POC не е affected от Component PR-и и не се нуждае от re-verification на всеки merge.
- **Promotion rule Phase 2 exception.** Promotion rule-ът от Section 4.2.2 — *нов код каца в `framework/` само през promotion от `tests-*` package* — има явно exception за Phase 2: framework-ският foundational код е *lifted* от `packages/legacy-poc/`, не promoted от team package. Това е единствената фаза, където директни framework writes от QA Automation са разрешени. След Phase 2 exit promotion rule-ът се прилага без exception.
- Всеки Component class има unit-style coverage чрез *един* dedicated spec под `packages/framework/tests/components/`, който exercise-ва основните му actions срещу known qa2 страница (без business assertions). Тези framework-own тестове работят в CI като dedicated package shard заедно с team packages.
- **CDP-access policy.** Където Component class има нужда от raw Chrome DevTools Protocol access (например Commission Fee combo workaround, който изисква `page.mouse.click()` срещу bounding-box coordinates), достъпът е encapsulated от един helper `withCdpClick(locator, options)`, exposed от `packages/framework/src/helpers/cdp.ts`. Component classes викат helper-а; те **не** отварят `CDPSession` сами. Helper-ът документира trade-off-а (работи само на Chromium; ignored под WebKit) и добавя `@chromium-only` tag annotation на всеки тест, който го consume-ва.
- **No CommonJS shim (D-35).** Legacy POC's `tests/_helpers/*.js` файлове са **оставени недокоснати** през Phase 2. Те запазват съществуващите си JS implementations и продължават да обслужват legacy POC-ския nightly до Phase 5 sunset. Framework's TS Components са *нов код*, lifted-and-rewritten от JS originals, не consumed от legacy POC. **Дублирането през migration window-а е приетата цена.** Защото POC freeze (D-13) влиза в сила на Phase 2 exit, дублираните JS helpers не еволюират — само framework's TS versions го правят — така че duplication-ът има bounded blast radius.
- **C25193 graduation lands at** `packages/tests-billing-servicing/tests/regression/account-billing/C25193.spec.ts`. От Phase 2 exit нататък, това е перманентният му дом — Phase 4 **няма** да го re-migrate-не.

#### 6.4.1 Phase 2 Internal Work Order (D-37)

Phase 2 deliverables имат строг dependency order. Phase 2 tracking issue трябва да следва тази последователност:

1. **API client first.** Build `packages/framework/src/api/client.ts` (retry, env-aware base URL, production safety guard от D-09) и typed `/qa/*` wrappers, ползвани от C25193's isolation модел: `DummyFirmApi`, `InvitationApi`. Всеки ship-ва със Zod schema и unit test, който assert-ва schema parsing срещу recorded fixture от реален qa2 response. **Authentication path (D-42):** API client-ът приема Playwright `APIRequestContext` от caller-а, никога не логва себе си. Caller-ът (типично fixture) provide-ва context, construct-ван със storage state от `auth.fixture.ts`. Има точно един auth path в програмата — през storage states.
1.1. **Framework playwright config.** Build `packages/framework/playwright.config.ts`, така че framework-ските собствени component smoke specs да работят като dedicated package shard в CI. Този config също извиква `definePlaywrightConfig` и provision-ва workspace-root storage state под `<workspace>/.auth/tim1.json`.
2. **Factories.** Build `FirmFactory` и `ProspectFactory` върху API client-а.
3. **`firm.fixture` и `worker-firm.fixture`.** Build `packages/framework/src/fixtures/workerFirm.fixture.ts` като typed worker-scoped fixture, ползвайки legacy `packages/legacy-poc/tests/_helpers/worker-firm.js` (~300 LOC, най-ценният актив на програмата) като behavioural reference. Legacy version остава на място per D-35, така че през Phase 2-4 **двете имплементации създават dummy firms паралелно** — това удвоява dummy firm accumulation на qa2/qa3, което е приемливо per existing "dummy firms accumulate, no cleanup" product behaviour. Дублирането приключва на Phase 5 sunset.
4. **Component lift.** Build `ReactDatePicker`, `ComboBox`, `AgGrid`, `NumericInput`, `TypeAhead` Component classes (Section 4.4) под `packages/framework/src/components/`. Всеки ship-ва със smoke spec под `packages/framework/tests/components/`.
5. **C25193 port.** Port legacy `C25193.spec.js` към `packages/tests-billing-servicing/tests/regression/account-billing/C25193.spec.ts`, consuming API client, factories, fixtures, и Components от стъпки 1–4. **Port PR-ът трябва да се merge-не в седмица 1 на Phase 2**, така че 5-night gating window (R-12 / Section 6.13) да работи паралелно с останалата Phase 2 работа, не в края.
6. **Cookbook.** С graduated C25193, напиши `docs/WRITING-TESTS.md`, използвайки C25193 като canonical worked example. Cookbook-ът е Phase 2 deliverable; ако C25193 ports late, cookbook-ът рискува да слипне до Phase 4 — оттам и week-1 правилото.

Стъпки 1, 2, 3 са плътно coupled (всяка зависи от предишната). Стъпка 4 (Component lift) е independent от стъпки 1–3 и *може* да върви паралелно ако вторият contributor (M3) поеме един track и primary-ят другия. Стъпки 5–6 трябва да са sequential и да gate-нат Phase 2 exit.

**Deliverables.**
- Пет Component classes със smoke coverage.
- Пет API client wrappers с Zod schemas.
- `C25193` migrated, зелен за пет последователни нощи срещу qa2.
- Четири documentation файлове в `docs/`.

**Exit criteria.**
- [ ] Legacy POC сюита все още минава в CI.
- [ ] Нов `C25193` parity gate met (5 последователни зелени нощи).
- [ ] Component smoke specs зелени срещу qa2 *и* qa3.
- [ ] Всички `/qa/*` calls минават през typed clients.
- [ ] Documentation reviewed и merged.
- [ ] **POC freeze** declared и announced.

**Dependencies resolved by entry:** D-08 (`__REACT_QUERY_CLIENT__` exposure) — ако не е delivered, документирай workaround в `WRITING-TESTS.md` и продължавай.

---

### 6.5 Phase 3 — Frontend Coordination & `data-testid` Kickoff

**Цел.** Установи frontend partnership-а, който отблокира selector stability за останалата миграция. Работи паралелно с Phase 4 веднъж щом kickoff-ът е стартиран.

**Scope.**
- Идентифицирай frontend owner-а (Decision **D-05**); насрочи kickoff meeting.
- Договори `data-testid` naming convention (предложен: `data-testid="<area>-<element>-<action>"`, например `account-billing-edit-save`).
- Land първия батч `data-testid` атрибути на Account Billing edit modal. Първият батч е **enumerated явно** в `docs/PAGE-OBJECTS.md` и е sized точно на елементите, ползвани от `C25193` и обкръжаващия `account-billing` Page Object: edit-modal trigger button, save button, cancel button, inception-date field, active-date field, commission-fee combo, и History grid container. Около 7–10 атрибута.
- Subsequent batches са sized по една feature area наведнъж и tracked в `docs/PAGE-OBJECTS.md`.
- Добави static-analysis script (`scripts/testid-coverage.ts`), който walks `src/pages/` и report-ва пропорцията selectors, ползващи `getByTestId` спрямо други стъпала. Wire-ни го в run summary.
- Документирай convention-а в `docs/PAGE-OBJECTS.md`.

**Deliverables.**
- Naming convention документ в `docs/PAGE-OBJECTS.md`.
- `data-testid` атрибути merged в Account Billing edit modal в GeoWealth repo-то.
- `scripts/testid-coverage.ts` и KPI emission.

**Exit criteria.**
- [ ] Първи батч `data-testid` атрибути deployed на qa2 и qa3.
- [ ] Coverage script reports baseline number за KPI-то.
- [ ] Frontend owner (D-05) acknowledged и в recurring sync.

**Dependencies resolved by entry:** D-05.

---

### 6.6 Phase 4 — Per-Team Migration в `tests-billing-servicing`

**Цел.** Migrate всеки feature area от текущия POC в `packages/tests-billing-servicing/`, retiring legacy specs като parity се достигне. Другите шест team packages са *scaffolded but empty* през Phase 4.

**POC area-to-team mapping (Decision D-25, owned от Program Owner).** Всички текущо имплементирани POC areas принадлежат на **Billing & Servicing**:

| POC area | Spec count | Target package | Phase 4 order |
|---|---|---|---|
| `account-billing` | 15 | `packages/tests-billing-servicing/tests/regression/account-billing/` | 1 (most mature; `C25193` already gated) |
| `create-account` | 7 | `packages/tests-billing-servicing/tests/regression/create-account/` | 2 (heavy ag-Grid; validates Components under load) |
| `billing-specs` | 4 | `packages/tests-billing-servicing/tests/regression/billing-specs/` | 3 (small; consolidates billing helpers) |
| `bucket-exclusions` | 13 | `packages/tests-billing-servicing/tests/regression/bucket-exclusions/` | 4 (validates XLSX builder layer) |
| `unmanaged-assets` | 12 | `packages/tests-billing-servicing/tests/regression/unmanaged-assets/` | 5 (similar shape to bucket exclusions; reuse builders) |
| `platform-one/merge-prospect` | 8 | `packages/tests-billing-servicing/tests/regression/merge-prospect/` | 6 (cross-feature dependencies; auth/role matrix) |
| `platform-one/auto-link` | 7 (всички `test.fixme`) | `packages/tests-billing-servicing/tests/regression/auto-link/` | Handed to Phase 5 |

> **Защо всички areas land-ват в `tests-billing-servicing` въпреки seven-team layout-а.** Към 2026-04-09, само Billing & Servicing екипът има имплементирано E2E content; другите шест team packages съществуват като empty bootstraps, така че monorepo plumbing-ът да е exercised end-to-end. Като други екипи започнат да authorra тестове post-Phase-5, те ще scaffold-нат свои packages през script-а и ще own-ват своя content от началото. Планът **не** speculatively re-home-ва POC content, който owning team не е поискал.

**За всеки area, следвай parity-gate workflow:**

1. **Един Phase 4 epic, седем area sub-tasks.** Phase 4 отваря един epic в issue tracker-а; всеки от седемте areas е sub-task linked към epic-а. Migration tracker (`docs/migration-tracker.md`) е per-spec ledger; issue tracker държи high-level rollup.
2. Build area-specific Page Objects под `packages/tests-billing-servicing/src/pages/<area>/<PageName>.ts` — **nested by area** for navigability.
3. **Port PR.** Rewrite спеца под `packages/tests-billing-servicing/tests/regression/<area>/` и merge. Спецът се мести в `ported`. Legacy спецът в `packages/legacy-poc/tests/<area>/` продължава да работи unchanged.
4. **Gating window.** Новият спец работи в CI за **пет последователни nightly runs** на qa2 *и* qa3. Failures reset броячата. Спецът се мести в `gating` на entry, `gated` на success.
5. **Deletion PR (отделен от port PR).** Веднъж щом спецът е `gated`, follow-up PR изтрива legacy спеца от `packages/legacy-poc/tests/<area>/`, премахва helper модули, ползвани само от него, и update-ва migration tracker. Спецът се мести в `deleted`. Port и deletion PR-ите са intentionally separate, така че gating window-ът да е visible в git history.
6. **Cohort flow.** Multiple specs от същия area могат да са в `gating` state паралелно; само *port PRs* се review-ват серийно в area. Cohort size е `min(5, ceil(area_size / 3))` per area (Section 6.13).
7. **`account-billing` head start.** `C25193` беше migrated и gated по време на Phase 2 (вече в `packages/tests-billing-servicing/tests/regression/account-billing/C25193.spec.ts`). Влиза в Phase 4 вече в `gated` state и е първият спец, преместен в `deleted` за area-то.

> **ADR note (`docs/adr/0001-feature-area-ordering.md`).** Това подреждане оптимизира за *успешни ранни победи* (most-mature first) за сметка на *късно откриване на architectural weaknesses*. Опозиционната стратегия — започни с най-трудната area за stress-test на framework-а — беше разгледана и отхвърлена защото:
> 1. Walking skeleton (Phase 0) и C25193 graduation (Phase 2) вече exercise-ват най-рисковите architectural surfaces преди Phase 4 да започне.
> 2. Първата feature area носи най-високия *process* risk, не най-високия *technical* risk; екипът има нужда от confidence-building win.

**Deliverables.**
- Per-area tracking issue closed за всяка от седемте areas.
- Всички TestRail cases mapped към spec под `packages/tests-billing-servicing/tests/regression/<area>/`.
- Legacy directory `packages/legacy-poc/tests/<area>/` deleted per area.
- Area-specific Page Objects covered от `WRITING-TESTS.md` examples.
- Migration tracker отразява всички spec state transitions.
- Шестте други team packages съществуват като empty bootstraps със зелени smoke specs.

**Exit criteria (per area).**
- [ ] 100% от in-scope TestRail cases имат green replacement под `packages/tests-billing-servicing/tests/regression/<area>/`.
- [ ] Legacy directory `packages/legacy-poc/tests/<area>/` deleted.
- [ ] Area pass rate ≥ 98% over the trailing 14 nights.

**Exit criteria (phase като цяло).**
- [ ] **Шест от седем areas** completed (`account-billing`, `create-account`, `billing-specs`, `bucket-exclusions`, `unmanaged-assets`, `merge-prospect`); `auto-link` явно handed off към Phase 5.
- [ ] `packages/legacy-poc/tests/_helpers/` reduced до само модули, все още ползвани от `auto-link`.
- [ ] `data-testid` coverage KPI ≥ 70% across migrated areas.
- [ ] Всички utilities под `packages/legacy-poc/scripts/` или ported към TypeScript или явно waived с `// allowJs-permanent: <reason>` коментари.
- [ ] **PR-gate latency re-baselined.** 8-минутният target беше set в Phase 1 срещу single walking-skeleton spec. С нараснал smoke set, target-ът се re-measure-ва на Phase 4 exit.

**Dependencies resolved by entry:** D-06, D-25, Phase 3 frontend kickoff in motion.

---

### 6.7 Phase 5 — Backlog Unblock & POC Sunset

**Цел.** Resolve `test.fixme` backlog-а, който беше deferred от по-ранни phases, retire последните legacy assets, и declare migration complete.

**Scope.**
- **Auto-link suite (`C26077`–`C26100`).** Имплементирай disposable email pool през `ProspectFactory` (Section 4.2). Verify срещу qa2 със fresh dummy firm per spec.
- **Merge Prospect permission-disabled scenarios (`C26060`, `C26085`).** Изисква backend cooperation: `/qa/createDummyFirm.do` трябва да приема `permissions` override. Tracked като cross-team dependency в Section 8.
- **Account Billing audit-trail gaps.** Координирай се с backend за потвърждение дали qa3 audit pipeline е fixed. Ако да, замени `// QA-ARCH-001:waived` skips с реални assertions.
- **Sunset the legacy POC.** Преди deletion, archive legacy helpers като `docs/historical/legacy-poc-helpers.tar.gz` (single tarball на `packages/legacy-poc/tests/_helpers/` и `packages/legacy-poc/scripts/`), така че бъдещ debugging да има reference. Tarball-ът се commit-ва веднъж и не се edit-ва.
- Изтрий целия `packages/legacy-poc/` package: премахва `tests/`, `tests/_helpers/`, legacy JS reporter, legacy `playwright.config.js`, и legacy `scripts/`. Премахни `legacy-poc` entry от workspace `package.json`. Drop `allowJs` от `tsconfig.base.json`. Single-PR cutover-ът от JS-on-Run-175 към TS-on-Run-175 (D-15) каца в същата промяна.
- **Final documentation pass.** Update `docs/ARCHITECTURE.md` с post-migration architecture; record lessons learned в `docs/RETROSPECTIVE.md`.
- **Post-migration test-authoring cookbook.** Update `docs/WRITING-TESTS.md` със секция "**Adding a new spec to an existing team package**".
- **Framework `v1.0.0` tag.** На Phase 5 exit, monorepo-то се tag-ва `v1.0.0`. Версията означава: legacy POC премахнат, всички седем Billing & Servicing areas migrated, `auto-link` backlog resolved или formally waived, framework's public surface stable, и post-migration cookbook complete. От `v1.0.0` нататък, breaking changes следват discipline-а в Section 6.11.

**Deliverables.**
- Auto-link suite зелена, без `test.fixme` markers.
- Merge Prospect blockers или resolved или formally accepted с recorded waiver.
- Legacy POC напълно изтрит.
- `tsconfig.json` strict-only (без `allowJs`).
- Retrospective document.

**Exit criteria.**
- [ ] `grep -r 'test\.fixme\|test\.skip' packages/` връща само entries с `QA-ARCH-001:waived <ticket>` markers.
- [ ] `packages/legacy-poc/` directory removed entirely.
- [ ] CommonJS shim removed; legacy JS reporter removed.
- [ ] `tsconfig.base.json` no longer sets `allowJs`.
- [ ] TestRail Run 175 е now driven от framework's TS reporter (atomic cutover, D-15).
- [ ] Всички KPIs в Section 9 meet или exceed targets за trailing 30 days.
- [ ] Migration formally closed с retrospective.

**Backend cooperation SLA.** Phase 5 backend dependencies (MERGE PROSPECT permission toggle и Account Billing audit-trail fix) носят explicit response SLA, agreed на Phase 4 exit:

| Backend ask | Acknowledgement SLA | Decision SLA | Implementation SLA |
|---|---|---|---|
| MERGE PROSPECT permission override on `/qa/createDummyFirm.do` | 5 working days от Phase 4 exit | 10 working days | 30 working days |
| Account Billing Inception Date audit-trail fix | 5 working days | 10 working days | Tracked but not blocking — Phase 5 closes с waiver ако не е delivered |

Ако някой ask пропусне acknowledgement SLA, escalate към responsible backend team lead и Engineering Manager. Phase 5 не може да приключи без или delivery или recorded waiver per ask.

**Dependencies resolved by entry:** Backend cooperation on permission toggle, със SLA-та accepted в писмен вид.

---

### 6.8 Phase Dependency Graph и паралелизация

```
Phase 0 ──► Phase 1 ──► Phase 2 ──┬──► Phase 3 ──┐
                                   │              ├──► Phase 4 ──► Phase 5
                                   └──────────────┘
                                          (Phase 3 може да върви паралелно с
                                           първата area на Phase 4 веднъж щом е kicked off)
```

**Strict ordering** (не може да се паралелизира):
- Phase 0 → Phase 1: CI не може да съществува без TS toolchain и зелен walking skeleton.
- Phase 1 → Phase 2: Component и API client работа трябва да върви в CI от първия commit.
- Phase 2 → Phase 4: Feature migration не може да започне без Component library, API client, и documentation set.

**Permitted parallelism:**
- Phase 3 (frontend coordination) може да започне през втората половина на Phase 2.
- В Phase 4, **само една feature area in flight в даден момент**. Page Object scaffolding за *следващата* area може да започне докато текущата е в parity-gate window-а.
- Cross-phase workstreams (Section 6.11) работят непрекъснато и никога не блокират phase transitions.

**Forbidden parallelism:**
- Две feature areas migrated едновременно — review burden, conflicting helper changes, ambiguous parity attribution.
- Phase 5 backlog работа преди Phase 4 да е retired dependent legacy areas.

### 6.9 Rollback и Contingency

Всяка фаза има defined rollback path. Миграцията е reversible до момента, в който legacy specs се изтриват.

| Phase | Failure mode | Rollback / Contingency |
|---|---|---|
| **0** | TypeScript toolchain incompatible с mixed JS/TS в Playwright | Revert `tsconfig.json` и `src/` skeleton на feature branch; reopen D-01 с concrete reproduction. POC сюита untouched. |
| **0** | Credential rotation чупи POC nightly | Restore rotated values през новия secret store; POC чете от env vars въведени в Phase 0. POC behavior verified в рамките на 24 часа. |
| **1** | Избраната CI platform не може да match-не PR-gate latency target (≤ 8 min) | Re-evaluate sharding и runner sizing; ако все още over budget, escalate D-02. Walking skeleton остава runnable локално. |
| **1** | TestRail reporter port produce-ва inconsistent results vs JS reporter | Дръж JS reporter pointed към Run 175; route TS reporter към sandbox run, докато parity не е proven over five nights. Switch е atomic и се случва само на Phase 5 sunset. |
| **1** | Pre-flight health-check има false positive и abort-ва valid nightly run | Manual override: `SKIP_PREFLIGHT=1` env var позволява on-call QA engineer да force-не run, audit в run summary. Repeated false positives в седмица pause-ват pre-flight gate-а. |
| **2** | Component shim чупи legacy specs | Revert affected Component файл; legacy `_helpers/ui.js` restored от git; investigate root cause без phase pressure. |
| **2** | `C25193` не може да достигне parity gate (5 green nights) | Analyze failure pattern: ако environment-driven, escalate към Platform; ако architectural, treat като foundational defect и pause Phase 3 / 4 entries. |
| **3** | Frontend не може да commit-не към `data-testid` rollout | Phase 4 все още продължава, но selectors fall back към role/label стъпалата на Section 4.7. KPI 4.10.6 reset към "blocked" и escalated monthly. Phase 5 не може да приключи без resolution. |
| **4** | Migrated area fail-ва parity gate многократно | Pause migration на *тази area само*; revert към legacy spec serving Run 175; root-cause без freezing на останалия Phase 4. |
| **4** | Legacy spec вече deleted, но нов spec regress-нал в production | Restore legacy spec от git (`git revert` на deletion commit) до fix на регресията. Parity gate-ът съществува, за да направи това рядко. |
| **5** | Backend permission-toggle за MERGE PROSPECT не е delivered | Record formal waiver срещу C26060 / C26085 с TestRail comment и `QA-ARCH-001:waived` marker; close Phase 5 без тези два cases. |
| **5** | Auto-link disposable email pool unreliable | Quarantine `auto-link` под `@flaky` до stabilization; не блокирай Phase 5 sunset на тази единствена area. |

### 6.10 Phase Verification Checklist (operational)

Кратък, mechanical checklist, ползван на всеки phase transition. QA Lead-ът минава през него на recorded call с поне един second reviewer.

1. Всички phase exit criteria checked off в tracking issue.
2. Decision register няма `OPEN` entries блокиращи следващата phase.
3. Section 8 dependencies за следващата phase са resolved или имат accepted workaround.
4. Section 9 KPIs не са regressed since последния phase entry.
5. Section 10 risks reviewed; никой нов risk scored ≥ 12 без owner.
6. Retrospective notes captured в `docs/RETROSPECTIVE.md` (само Phase 5) или в tracking issue (други phases).
7. Stakeholder communication изпратен към **agreed channel**, обобщавайки какво се е променило. За Phase 0 transitions канал-ът е QA team's existing email distribution list (или еквивалент), защото `#qa-alerts` е сам по себе си Phase 1 deliverable; от Phase 1 нататък е `#qa-alerts`.

### 6.11 Cross-Phase Workstreams

Тези работят непрекъснато през multiple phases и не са phases сами по себе си:

| Workstream | Active during | Owner | Notes |
|---|---|---|---|
| **Knowledge transfer (R-11 mitigation)** | Phases 0–5 | QA Lead | Pair-programming на всеки PR; weekly framework deep-dive sessions; recruit на втори QA Automation contributor до края на Phase 1 (M3). |
| **Decision register hygiene** | Всички phases | QA Lead | Всеки phase entry изисква blocking decisions resolved (Section 7). |
| **Risk review** | Monthly | QA Lead | Reassess Section 10 risks; promote нови risks discovered in-flight. |
| **POC stabilization** | Phases 0–4 | QA Automation | POC продължава да доставя Run 175 results; **enforced** от ESLint rule и CODEOWNERS — виж "POC Freeze Enforcement" отдолу. |
| **Frontend `data-testid` rollout** | Phases 3–5 | Frontend lead | Continues per area като Phase 4 advance-ва. |
| **Migration tracker maintenance** | Phases 2–5 | QA Lead | Single source of truth за spec status. |

**Migration Tracker (artifact).** Един Markdown файл в `docs/migration-tracker.md`, committed в workspace root и updated от всеки port и deletion PR. Един row per legacy spec, columns: `area`, `case_id`, `legacy_path` (винаги под `packages/legacy-poc/`), `target_package` (consuming `tests-<team>/` package, в момента винаги `tests-billing-servicing` per D-25), `new_path`, `state` (`pending` | `ported` | `gating` | `gated` | `deleted`), `owner`, `last_state_change`, `notes`. Полето `last_state_change` е **попълвано от CI hook** на merge time, никога от хора. PR template изисква всеки Phase 4 PR да update-не своя row в същия commit; CI fail-ва PR-а ако row-ът липсва или е out of date. Tracker-ът е input за Section 9 KPI "Parity-gate compliance" и source of truth, който scaffold script чете при генериране на team's section header.

**Backup и disaster recovery.** Framework code, migration tracker, templates, и всеки config файл живеят в git — `git history` е backup of record. Три неща *не са* в git и имат explicit recovery paths:
1. **Developer `.env.local` файлове.** Загубен? Re-issue от secret store. Owner: всеки developer.
2. **CI secrets в secret store.** Загубени? Re-issue от Security. Owner: Security.
3. **qa2 / qa3 environment data** (firms, accounts, custodian seeds). Загубени? POC и новият framework и двата викат `/qa/createDummyFirm.do` за per-worker isolation, така че wiped environment се възстановява чрез re-running на сюитата. Static seed data (Firm 106, `tyler`) е owned от GeoWealth Platform team's environment-restore процес.

Migration tracker файлът сам по себе си е checked into git и reviewed на всеки PR — accidental truncation се хваща от `git diff`. Не е нужен external backup.

**Framework breaking-change discipline (D-39).** Със single-version (D-27) и `workspace:*` consumption, всяка framework change достига всеки team package в същата нощ. Няма "pin and upgrade later" escape valve. Discipline-а:

1. **Two-step deprecation.** Breaking change към exported framework symbol изисква deprecation warning, който каца *един nightly run преди* symbol-а да бъде премахнат. `@deprecated` JSDoc tag плюс runtime `console.warn` са задължителни.
2. **Framework-change PR template.** Всеки PR, пипащ `packages/framework/src/`, добавя "Breaking change?" checkbox; ако checked, PR-ът се hold-ва за explicit QA Lead approval и `docs/CHANGELOG.md` entry е mandatory.
3. **Consumer impact preview.** PR description-ът трябва да изброи всеки team package, който import-ва affected symbol (CI check изпълнява `grep` през `packages/tests-*/` и принтира list-а като PR comment).
4. **Cross-team review.** Breaking-change PRs изискват approving review от поне един consuming team owner (не само QA Automation). CODEOWNERS файлът е routing-ът.

**`run-summary.json` schema (D-40).** Всяко per-package CI invocation emit-ва `run-summary.json` artifact. Schema:

```typescript
interface RunSummary {
  schemaVersion: '1';
  package:       string;            // e.g. "@geowealth/tests-billing-servicing"
  environment:   'qa1' | 'qa2' | 'qa3' | 'qa4' | 'qa5' | 'qa6' | 'qa7' | 'qa8' | 'qa9' | 'qa10' | 'qatrd';
  commitSha:     string;
  startedAt:     string;            // ISO-8601 UTC
  durationMs:    number;
  totals:        { passed: number; failed: number; skipped: number; flaky: number };
  byTag:         Record<string, { passed: number; failed: number; durationMs: number }>;
  preflightSkipped: boolean;        // true iff SKIP_PREFLIGHT=1 was used
  testRailCaseIds: number[];        // for the per-nightly aggregator (D-30)
}
```

Aggregator-ът (`testrail-aggregator.ts`) и time-series push-ът consume-ват този contract; producer и consumer са pinned към `schemaVersion: '1'`. Breaking schema change bump-ва version field-а и се третира като framework breaking change.

**POC Freeze Enforcement (Phase 2 exit нататък).** "Без нови тестове в `packages/legacy-poc/tests/<feature>/`" е enforced механически, не от review discipline:

1. Custom ESLint rule (`local-rules/no-new-legacy-spec`) flag-ва всеки newly created `.spec.js` файл под directories, listed в sidecar config файл `.eslintrc.legacy-areas.json` в workspace root. Sidecar-ът е flat JSON array на glob patterns, например `["packages/legacy-poc/tests/account-billing/**", ...]`. ESLint rules са JavaScript и не могат да parse-ват Markdown, така че migration tracker **не** е ESLint input — sidecar JSON е, и CI job update-ва sidecar-а в lockstep когато area state се променя в tracker-а.
2. CODEOWNERS ползва **structured section markers**, така че scaffold script и хора могат да го edit-ват без conflicts:
   ```
   # === BEGIN scaffold-managed: team packages ===
   /packages/tests-billing-servicing/  @geowealth/billing-servicing-qa @geowealth/qa-leads
   /packages/tests-platform/           @geowealth/platform-qa          @geowealth/qa-leads
   ...
   # === END scaffold-managed ===

   # === BEGIN human-managed: framework, tooling, legacy ===
   /packages/framework/                @geowealth/qa-leads
   /packages/tooling/                  @geowealth/qa-leads
   /packages/legacy-poc/               @geowealth/qa-leads
   # === END human-managed ===
   ```
   Scaffold script-ът edit-ва **само** section-а между scaffold-managed markers; всичко друго е human-edited.
3. Bug-fix PRs към legacy specs трябва да референцират original spec's TestRail case ID и да link-ват към defect ticket; PR template enforce-ва това.
4. Freeze-ът се announce-ва към agreed channel на Phase 2 exit, с tracker-а linked.

### 6.12 Resourcing и Effort Sizing

Усилието е изразено в T-shirt sizes срещу baseline на един full-time QA Automation engineer. Sizes assume-ват, че dependencies в Section 8 са resolved on time; blocked phases са sized отделно.

| Phase | Size | Drivers | Required skills | Primary owner | Supporting roles |
|---|---|---|---|---|---|
| **0** Foundation & Security Hotfix | **S** | Security rotation е long pole-ът, не scaffold-ът. | TypeScript setup, secret rotation, Playwright config. | QA Automation | Security (rotation), QA Lead (review). |
| **1** CI Bootstrap + Scaffold | **L** (re-sized per D-29) | CI provisioning + scaffold script + affected-detection + reporter port + TestRail aggregator + version-check + scaffold-test workflow. | CI/CD, TS, TestRail API, monorepo tooling. | QA Automation | Platform / DevOps, QA Lead, втори QA contributor (M3 mandatory). |
| **2** Components, API Client, Docs | **L** | Пет Components × пет API clients × четири docs × C25193 graduation spec. | Playwright internals, React widget knowledge, Zod, technical writing. | QA Automation | QA Lead (doc reviews), втори QA contributor (R-11). |
| **3** Frontend Coordination Kickoff | **S** (QA effort) / **M** (frontend effort) | Предимно meetings, convention agreement, и coverage script. | Stakeholder management, simple AST tooling. | QA Lead | Frontend lead (real implementer). |
| **4** Feature-Area Migration | **XL** | Шест feature areas × parity gate × CI stabilization. | Всичко горе плюс deep familiarity с всяка feature area. | QA Automation | Per-feature QA contacts, втори QA contributor. |
| **5** Backlog Unblock & POC Sunset | **M** | Auto-link и merge-prospect blockers; sunset е mechanical. | Backend coordination, factory design. | QA Automation | Backend leads (toggles, audit fixes). |

**Ако Phase 2 или Phase 4 работи без втори QA contributor**, размерът на phase-а ескалира с една степен (Phase 2: L → XL; Phase 4: XL → XXL) и програмата става single-point-of-failure (Risk R-11). M3 (Section 6.15) прави second-contributor commitment hard gate за Phase 2 entry, не aspiration.

### 6.13 Parity Gate — Calendar Reality и Cohort Sizing

Parity gate-ът от "5 последователни зелени nightly runs" е quality keystone-ът на програмата, но има calendar cost, който трябва да се планира.

**Per-spec cost.** Спец, влизащ в gate в понеделник, най-рано достига `gated` в събота сутрин (5 nightly runs over 5 calendar nights). Failure на която и да е нощ reset-ва брояча, така че реалистичният per-spec gate budget е **7–10 calendar days**, не 5.

**Throughput math.** Ако Phase 4 има около 50 спецове и са run серийно, total gate time би било 50 × 7 = 350 дни — clearly unworkable. Планът разрешава multiple specs да са в `gating` state паралелно:

| Concurrency policy | Value | Reason |
|---|---|---|
| Max in-flight `gating` specs per area | `min(5, ceil(area_size / 3))` | Scale-ва с area size — small areas (`billing-specs`, 4 specs) gate at most 2 паралелно; large areas (`account-billing`, 15 specs) gate at most 5. |
| Hold-back rule | Нови port PRs в area pause-ват, когато area's gating queue е full *или* in-flight gating spec е failed в последните две нощи | Force-ва stabilization преди piling on. |

> По-ранната cohort policy включваше "max 12 in-flight `gating` specs across the program" cap. С правилото "една feature area in flight в даден момент" (Section 6.6), program-wide cap-ът е unreachable — per-area cap (≤ 5) винаги печели. Program-wide cap беше dead code и е премахнат. Ако "one area at a time" някога се loosen-не, restore program-wide cap едновременно.

**Time-to-`gated` е tracked metric.** Median per-spec gate duration се report-ва в migration tracker; ако превиши 14 calendar days за две поредни седмици, gate definition се review-ва (5-night threshold-ът може да се loosen-не до 3 за low-risk specs, с recorded waiver per spec).

### 6.14 Program Governance

Тази подсекция capture-ва program-management въпросите, които техническите фази assume-ват, че са отговорени.

**Single accountable Program Owner.** Един named individual — **Program Owner** — е accountable за успеха на миграцията. Program Owner е QA Lead by default, но role-ът може да се delegate-не by name в Phase 0 tracking issue. Program Owner:
- Chairs weekly status report и phase verification calls.
- Държи kill-criteria decision (виж отдолу).
- Resolve-ва cross-team escalations в рамките на 48 часа.
- Maintain-ва Decision Register и migration tracker.

**Kill criteria — кога програмата се изоставя и POC се запазва.** Миграцията се **спира**, ако някое от следните стане true:
1. **Critical security finding не може да се remediate в Phase 0.** Ако credential rotation не може да приключи и историческият leak не може да бъде или rewritten или formally accepted, програмата се pause-ва безсрочно, докато Security изясни пътя.
2. **Две последователни phases пропускат планирания exit с над 100% от планираната им duration.** Това signal-ва systemic estimation failure.
3. **R-11 не може да се mitigate.** Ако втори QA contributor не може да бъде recruited до края на Phase 1 *и* Engineering Manager не може да предложи alternative (loaned engineer, contractor), Phase 2 не започва. Програмата чака.
4. **Backend cooperation fails categorically.** Ако нито MERGE PROSPECT toggle нито audit-trail fix е delivered след един full SLA cycle plus one extension, Phase 5 closes с два waivers и програмата се declared complete-with-known-gaps. *Това е partial kill, не full.*
5. **Cumulative phase duration надвишава 200% от планирания working-week budget** (Section 6.14 schedule), без да produce-ва зелен Phase 4 area. Measured срещу relative-week плана.

Kill decision е на Program Owner-а, made в consultation с Engineering Manager и recorded като `KILLED` decision в Section 7. POC и TestRail Run 175 продължават да работят; framework branch-ът се park-ва, не се изтрива.

**Phase scheduling.** Всяка phase носи *planned relative duration*, изразен в working weeks, recorded в phase tracking issue на phase entry. Absolute calendar dates не са в този документ, защото зависят от team availability.

| Phase | Planned relative duration | Notes |
|---|---|---|
| 0 | 1–2 weeks | Long pole е Security availability за credential rotation. |
| 1 | **2–3 weeks** (re-baselined per D-29) | CI bootstrap + scaffold script + affected detection + TestRail reporter port + per-package matrix. |
| 2 | 4–6 weeks | Cross-package Component lift + C25193 graduation. |
| 3 | 1 week QA effort, върви паралелно с началото на Phase 4 | Frontend effort е извън QA accounting. |
| 4 | 8–12 weeks | Седем areas × parity gate × cohort throughput. |
| 5 | 2–4 weeks | Driven от backend SLA. |

**Status reporting cadence.** Weekly status report се публикува всеки петък от Program Owner към agreed channel. Report-ът ползва template-а в `docs/status-report-template.md` (created в Phase 0) и съдържа:
- Текуща phase, week N of M planned weeks.
- Exit criteria checked off vs. remaining.
- Нови risks и decisions от последния report.
- Asks към stakeholders.
- Един "RAG" indicator (Red / Amber / Green) за програмата като цяло.

Три последователни Amber или който и да е Red триггърва escalation review с Engineering Manager.

**Phase verification artifact.** Section 6.10 изисква "recorded call". Артефактът е **signed verification record**, committed в `docs/phase-verifications/phase-N.md`, съдържащ: дата, attendees, всеки checklist item с pass/fail, decisions confirmed, decisions deferred, link към call recording. Следващата phase не може да влезе без previous phase verification record merged към `master`.

**Dry-run / pilot за credential rotation.** Phase 0 Step B (credential rotation) се rehearse-ва първо срещу **non-production sandbox account** (throwaway TestRail user, throwaway GeoWealth dummy admin). Sandbox rehearsal-ът валидира, че (а) env-var refactor reaches all references, (б) secret-store handoff работи, (в) rollback path-ът е exercised. Само тогава real rotation се attempt-ва.

**Framework versioning.** Framework repo следва **SemVer 2.0**. Първият tagged release е `v0.1.0` в края на Phase 0. Phase exits produce-ват minor bumps; spec migrations са patch bumps; breaking changes към Page Object или fixture APIs изискват major bump и entry в `docs/CHANGELOG.md`.

### 6.15 Bus-Factor Mitigation Milestones (R-11)

Risk R-11 (single contributor, score 20) е highest-scored risk-ът в register-а. Migration plan-ът го addresses-ва през тези явни milestones, не през надежда:

| Milestone | Phase | Definition of done |
|---|---|---|
| **M1 — Onboarding doc exists** | End of Phase 2 | `docs/ONBOARDING.md` е reviewed от non-author, който, без verbal help, може да clone-не, configure-ва, и run-не walking-skeleton spec локално. |
| **M2 — Pair-programming cadence** | Phases 0–5 | Поне един PR per week е co-authored или pair-reviewed от втори човек. Tracked в weekly status report. |
| **M3 — Second contributor identified** | **End of Phase 1** | Named individual е committed за поне 50% от времето си към framework-а. Phase 1 е latest acceptable point, защото Phase 2 е largest single phase (size L) и един човек, носещ я сам, е exact bus-factor failure mode-а, който този milestone съществува да предотврати. Ако не е met до края на Phase 1, escalate към Engineering Manager и **pause Phase 2 entry** до resolution. |
| **M4 — Knowledge-transfer session series** | Phases 2–4 | Weekly 30-минутен deep-dive върху един architectural area (fixtures, Components, API client, isolation, CI). Recordings archived в Confluence. |
| **M5 — Architecture decision records** | Phases 0–5 | Всеки non-obvious architectural choice е captured като ADR в `docs/adr/`, така че rationale-ът да оцелее original author-а. |

Тези milestones promote-ват R-11 от "passive monitoring" към active risk reduction и са reviewed на всяка phase verification (Section 6.10).

---

## 7. Decision Register

Всяко решение по-долу е owned, dated, и tracked през до acceptance. Регистърът е single source of truth — `OPEN` items блокират зависещи migration phases до resolution.

**Phase index — кои decisions блокират коя phase (бърза навигация):**

| Phase | OPEN decisions блокиращи entry |
|---|---|
| Pre-Phase 0 | D-01, D-04 (superseded → виж D-24), D-07, D-11, D-19, D-22, D-24, D-25, D-26, D-27, D-28, D-31, D-34 |
| Phase 0 → Phase 1 | D-03 (secret store namespace populated), D-20 (history rewrite/accept) |
| Phase 1 → Phase 2 | D-02 (CI platform live), D-08 (`__REACT_QUERY_CLIENT__` exposed) |
| Phase 2 → Phase 3 | D-37 (Phase 2 internal order completed), D-32 (promotion-rule exception observed) |
| Phase 3 → Phase 4 | D-05 (frontend `data-testid` owner committed), D-06 (first migration scope confirmed) |
| Phase 4 → Phase 5 | D-18 (backend cooperation SLA accepted) |

Решенията, маркирани **DECIDED** по-долу, бяха authored като recommendations от QA Automation; rows с QA Lead или Program Owner като owner await formal ratification на Phase 0 kickoff. Kickoff verification record (Section 6.10) изброява всяко решение под "Decisions confirmed".

| ID | Decision | Status | Recommendation | Owner | Due | Blocks |
|---|---|---|---|---|---|---|
| D-01 | Adopt TypeScript strict mode | OPEN | **Yes** — refactor safety dominates over time. | QA Lead | Pre-Phase 0 | All phases |
| D-02 | CI platform (GitHub Actions / GitLab CI / Jenkins) | OPEN | TBD — depends on existing GeoWealth CI footprint. | Platform lead | Pre-Phase 1 | Phase 1 |
| D-03 | Secret store (GitHub Secrets / Vault / AWS Secrets Manager) | OPEN | Align with whatever the chosen CI uses natively. | Security lead | Pre-Phase 0 | Phases 0 and 1 |
| D-04 | Repository topology (standalone vs `~/nodejs/geowealth/e2e`) | SUPERSEDED by D-24 (multi-team monorepo with npm workspaces) | Виж D-24 в този регистър | — | — | — |
| D-05 | Frontend `data-testid` rollout owner | OPEN | Nominate one frontend lead; staged adoption per feature area. | Frontend lead | Pre-Phase 3 | Phase 3 |
| D-06 | First migration scope | OPEN | `account-billing` като reference area. | QA Lead | Pre-Phase 4 | Phase 4 |
| D-07 | TestRail Run 175 cadence during migration | OPEN | Phased approach; POC keeps reporting until each spec is ported. | QA Lead, Product | Pre-Phase 0 | Migration sequencing |
| D-08 | React Query / Redux QA hooks on `window` (`FOR_QA=true`) | OPEN | Frontend exposes `__REACT_QUERY_CLIENT__`; gated by build flag. | Frontend lead | Pre-Phase 2 | Section 4.10.4 patterns |
| D-09 | Production safety: ban `/qa/*` calls when `TEST_ENV=production` | DECIDED | Implemented in `ApiClient` constructor. Never overridable. | QA Automation | 2026-04-09 | — |
| D-10 | Dummy firm naming convention `e2e-<timestamp>` | DECIDED | Documented in Section 5.8. | QA Automation | 2026-04-09 | — |
| D-11 | Treat existing committed credentials in `testrail.config.json` as compromised; rotate before any other Phase 0 work | OPEN | **Yes** — Critical-severity finding (Section 2.2). | Security, QA Lead | Phase 0, day 1 | Phase 0 |
| D-12 | Parity gate: 5 consecutive green nightly runs before deleting any legacy spec | DECIDED | Codified in Section 6.1 principle 4. | QA Lead | 2026-04-09 | Phase 4 |
| D-13 | POC freeze: no new specs in legacy `tests/<feature>/` after Phase 2 exit | DECIDED | Section 6.1 principle 5. | QA Lead | 2026-04-09 | Phase 4 |
| D-14 | Parity-gate cohort sizing (max 5 in-flight gating per area) | DECIDED | Section 6.13. Loosenable to 3 nights for low-risk specs by waiver. | QA Lead | 2026-04-09 | Phase 4 throughput |
| D-15 | TestRail Run 175 cutover from JS to TS reporter is single-PR atomic at Phase 5 sunset | DECIDED | Sections 6.3 and 6.7. Two reporters never write to Run 175 simultaneously. | QA Automation | 2026-04-09 | Phase 5 |
| D-16 | POC freeze enforced by ESLint rule + CODEOWNERS, not review discipline | DECIDED | Section 6.11 "POC Freeze Enforcement". | QA Lead | 2026-04-09 | Phase 4 |
| D-17 | Phase 4 ordering favors mature areas first (account-billing); rationale recorded as ADR-0001 | DECIDED | Section 6.6 ADR note. | QA Lead | 2026-04-09 | Phase 4 |
| D-18 | Phase 5 backend cooperation SLA (5d ack / 10d decision / 30d implementation) | OPEN | Yes — accepted by backend leads at Phase 4 exit. | Backend leads, QA Lead | Phase 4 exit | Phase 5 |
| D-19 | Pin Node 20 LTS, Playwright 1.47, TS 5.5, Zod 3.23, dotenv-flow 4.1, ESLint 10.2; commit `package-lock.json`; CI uses `npm ci` | DECIDED | Section 6.2 technical preconditions. | QA Automation | 2026-04-09 | Phase 0 |
| D-20 | Git history: rewrite versus formally accept the historical credential leak | OPEN | Security chooses at the end of Phase 0 Step C. | Security | Phase 0 Step C | Phase 0 exit |
| D-21 | ~~CommonJS↔TS shim via dynamic import~~ — **SUPERSEDED by D-35**. | SUPERSEDED by D-35 | — | — | — | — |
| D-22 | Named Security counterpart for credential rotation must exist before Phase 0 starts | OPEN | Yes — without a named individual, Phase 0 cannot begin. | Engineering Mgr | Pre-Phase 0 | Phase 0 |
| D-23 | qa2 stability fallback: switch the walking skeleton to qa3 if qa2 fails for two consecutive Phase 0 nights | DECIDED | Section 6.2 Step G. `TEST_ENV` is the override. | QA Automation | 2026-04-09 | Phase 0 |
| D-24 | **Monorepo with npm workspaces** (supersedes D-04). | DECIDED | Section 4.2 + ADR-0002. | QA Lead, Eng Mgr | 2026-04-09 | All phases |
| D-25 | POC area-to-team mapping: **all currently implemented POC areas belong to Billing & Servicing**. | DECIDED | Section 6.6. | Program Owner | 2026-04-09 | Phase 4 |
| D-26 | Scaffold script е Phase 1 first-class deliverable, с 30-минутен SLA enforced от CI workflow | DECIDED | Section 4.2.5. | QA Automation | 2026-04-09 | Phase 1 |
| D-27 | Single monorepo version | DECIDED | Section 6.14 framework SemVer. | QA Lead | 2026-04-09 | All phases |
| D-28 | Workspace tooling: vanilla npm workspaces (no pnpm, Turborepo, или Nx) | DECIDED | Section 4.2. | QA Automation | 2026-04-09 | All phases |
| D-29 | Phase 1 re-sized from **M to L** (planned 2–3 working weeks). | DECIDED | Section 6.3 size note. | QA Lead | 2026-04-09 | Phase 1 |
| D-30 | TestRail per-package aggregation | DECIDED | Section 6.3 "TestRail aggregation". | QA Automation | 2026-04-09 | Phase 1 |
| D-31 | Legacy POC keeps existing `playwright.config.js` (no rename). | DECIDED | Section 6.2 Step 0.B. | QA Automation | 2026-04-09 | Phase 0 |
| D-32 | Phase 2 promotion-rule exception | DECIDED | Section 6.4. | QA Lead | 2026-04-09 | Phase 2 |
| D-33 | Storage state naming convention | DECIDED | Section 4.2.3.2. | QA Automation | 2026-04-09 | All phases |
| D-34 | Scaffold templates са source of truth от Phase 0 Step G | DECIDED | Section 6.2 Step 0.G. | QA Automation | 2026-04-09 | Phase 0, Phase 1 |
| D-35 | **Kill the shim.** Legacy POC държи свои JS helpers до Phase 5 sunset. | DECIDED | Section 6.4 (Phase 2 scope). Supersedes D-21. | QA Automation | 2026-04-09 | Phase 2 |
| D-36 | `packages/framework/package.json` декларира явно `exports` field | DECIDED | Phase 0 Step 0.F deliverable. | QA Automation | 2026-04-09 | Phase 0 |
| D-37 | Phase 2 internal work order е *strict* (Section 6.4.1) | DECIDED | Section 6.4.1. | QA Lead | 2026-04-09 | Phase 2 |
| D-38 | Single workspace-root ESLint flat config | DECIDED | Phase 0 Step 0.A. | QA Automation | 2026-04-09 | Phase 0 |
| D-39 | Framework breaking-change discipline | DECIDED | Section 6.11. | QA Lead | 2026-04-09 | All phases from Phase 2 |
| D-40 | `run-summary.json` schema version 1 | DECIDED | Section 6.11. | QA Automation | 2026-04-09 | Phase 1 |
| D-41 | Storage states shared at workspace root | DECIDED | Section 6.2 Step 0.G. | QA Automation | 2026-04-09 | Phase 0 |
| D-42 | API client accepts `APIRequestContext`; никога не логва себе си | DECIDED | Section 6.4.1 step 1. | QA Automation | 2026-04-09 | Phase 2 |
| D-43 | Legacy-poc hoist policy | DECIDED | Section 6.2 Step 0.B. | QA Automation | 2026-04-09 | Phase 0 |
| D-44 | Phase 0 starts с walking-skeleton selector reconnaissance (Step 0.0) | DECIDED | Section 6.2 Step 0.0. | QA Automation | 2026-04-09 | Phase 0 |

Status values: `OPEN` (awaiting decision), `DECIDED` (recorded with rationale), `SUPERSEDED` (replaced by a later decision; cross-reference required).

---

## 8. Cross-Team Dependencies

Framework-ът не може да успее в изолация. Всяка зависимост по-долу има named owner и target resolution date.

| Dependency | Required from | Required by phase | Status |
|---|---|---|---|
| `data-testid` атрибути на Account Billing screens (и feature areas нататък) | Frontend team | Phase 3 → Phase 4 | Не започната — gated by D-05 |
| `__REACT_QUERY_CLIENT__` exposed под `FOR_QA=true` | Frontend team | Phase 2 (component layer) | Не започната — gated by D-08 |
| Stable `/qa/createDummyFirm.do` под load (без qa2 queueing > 60 s) | Backend / Platform | Phase 0 | Known degradation; mitigated by retries |
| CI platform provisioned и достъпна от QA repo | Platform / DevOps | Phase 1 | Pending D-02 |
| Secret store namespace за QA credentials | Security | Phase 0 | Pending D-03 |
| Slack webhook към `#qa-alerts` | Platform | Phase 1 | Не започната |
| Time-series store endpoint за run metrics | Platform | Phase 1 (best effort) → Phase 2 (firm) | Не започната |
| Confluence space за living documentation | QA Lead | Phase 0 Step E | Не започната |
| Named Security counterpart за credential rotation (D-22) | Engineering Mgr | Pre-Phase 0 | Не започната — **Phase 0 не може да започне без това** |
| Sandbox TestRail user + sandbox GeoWealth admin за credential-rotation dry run | QA Lead | Pre-Phase 0 | Не започната |
| Single named Program Owner committed (Section 6.14) | Engineering Mgr | Pre-Phase 0 | Не започната |
| Frontend leads identified за всяка от седемте team feature surfaces | Frontend leads | Phase 3 → Phase 4 | Не започната — D-05 може да трябва да се split per team |
| Confirmation, че шестте non-Billing-Servicing team contacts знаят, че получават empty bootstrap package в Phase 0 | Program Owner | Pre-Phase 1 | Не започната |
| Throwaway TestRail user + throwaway GeoWealth dummy admin за Phase 0 Step 0.D credential-rotation dry run | TestRail admin + Program Owner | Pre-Phase 0 Step 0.D | Не започната |
| Pre-flight `tim1` credentials usable от non-developer machine (CI runner identity) | Security + Platform | Phase 1 entry | Не започната |
| Втори QA Automation contributor (R-11 mitigation, milestone M3) | Engineering Mgr | End of Phase 1 | Не започната |
| Backend permission-toggle за `MERGE PROSPECT` (per-firm) | Backend team | Phase 5 | Не започната — required to unblock C26060 / C26085 |
| Audit-trail fix за Account Billing Inception Date в qa3 | Backend team | Phase 5 | Open from POC notes |

---

## 9. Success Metrics и KPIs

Стойността на framework-а е measurable. Следните KPIs се review-ват monthly от QA Lead-а и quarterly с engineering leadership.

| KPI | Definition | Target | Source |
|---|---|---|---|
| **Suite size** | Брой `@regression` спецове | Quarterly growth aligned with feature delivery | Playwright run summary |
| **Pass rate (regression)** | `passed / (passed + failed)` за last 14 nightly runs | ≥ 98% | Time-series store |
| **Flake rate** | Спецове failing then passing on retry / total специи | ≤ 2% week over week | Time-series store |
| **Mean spec duration** | Median over `@regression` | ≤ 45 s; p95 ≤ 120 s | Playwright run summary |
| **Wall-clock for nightly** | End-to-end pipeline duration per environment | ≤ 60 min | CI metadata |
| **PR gate latency** | Median PR-gate pipeline duration | ≤ 8 min | CI metadata |
| **`data-testid` coverage** | Процент Page Object selectors, ползващи `getByTestId` | Baseline reported by end of Phase 3; ≥ 70% by end of Phase 4 | Static analysis script |
| **Mean time to triage** | Часове от nightly failure до assigned owner | ≤ 4 working hours | Triage tooling |
| **Quarantine clearance** | `@flaky` спецове resolved в 10 working days | ≥ 90% | TestRail / repo audit |
| **Test debt ratio** | `(test.skip + test.fixme) / total спецове` | ≤ 5% | Static analysis script |
| **TestRail coverage** | Active `@regression` спецове mapped към TestRail cases | 100% | TestRail reporter audit |
| **Parity-gate compliance** | Migrated спецове, които достигнаха 5 последователни зелени нощи преди legacy deletion | 100% | Migration tracker |
| **Phase exit on time** | Phases closed в +25% от планирания relative duration | ≥ 80% | Phase tracking issues + verification records |
| **Bus-factor coverage** | Architectural areas с поне двама contributors | ≥ 50% by end of Phase 2; ≥ 90% by end of Phase 4 | CODEOWNERS audit |

---

## 10. Risk Register

Risks са scored на 1–5 scale за likelihood (L) и impact (I). Score = L × I.

| ID | Risk | L | I | Score | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R-01 | TypeScript adoption stalls migration ако екипът е unfamiliar | 2 | 4 | 8 | Pair-programming during Phase 0; code-review checklist; team training session before Phase 2. | QA Lead |
| R-02 | `data-testid` rollout deprioritized от frontend team | 4 | 4 | 16 | Phase 3 kickoff (Section 6.5) commits a frontend owner; track in Section 9 KPI; escalate to engineering management at 60 days no movement. Phase 5 cannot exit without resolution. | QA Lead, Frontend lead |
| R-03 | Dummy firm accumulation degrades qa2 / qa3 performance | 2 | 4 | 8 | Quarterly Platform audit (Section 5.8); contingency cleanup script kept ready. | Platform lead |
| R-04 | `/qa/*` endpoints change shape without notice | 3 | 3 | 9 | Zod schemas (Section 4.6); add `/qa/*` change notifications to backend team's PR template. | Backend leads |
| R-05 | ag-Grid Enterprise upgrade breaks selectors and editor activation | 2 | 5 | 10 | Component class isolates the surface; nightly run will detect within 24 h; ag-Grid changelog subscription. | QA Automation |
| R-06 | qa2 / qa3 environment instability causes false negatives | 4 | 3 | 12 | Pre-flight job (Section 5.9, built in Phase 1); environment quarantine workflow; clearly distinguishable env-failure errors. | Platform lead |
| R-07 | Credential leak from POC's committed `testrail.config.json` | 3 | 5 | 15 | **Phase 0 day-1 rotation** (Decision D-11) plus secret-scanning pre-commit hook; full git history audit by Security before public-facing release. | Security |
| R-08 | Flake budget breached, freezing test additions | 3 | 3 | 9 | Stabilization SLA (Section 5.6); weekly review meeting; fast-track quarantine. | QA Lead |
| R-09 | TestRail integration failure during nightly | 2 | 2 | 4 | Existing reporter retry/fallback (POC); TS port validated against sandbox in Phase 1 before pointing at Run 175; local artifact retained for manual import. | QA Automation |
| R-10 | Migration goes long; POC and new framework drift | 3 | 4 | 12 | Time-boxed phases; POC freeze at Phase 2 exit (D-13); weekly status report; explicit sunset criteria in Phase 5. | QA Lead |
| R-11 | Single QA Automation contributor — bus factor of 1 | 4 | 5 | 20 | Bus-factor milestones M1–M5 in Section 6.15. Recruiting a second contributor by end of Phase 1 (M3) is the program's hardest non-technical commitment. | Engineering Mgr |
| R-12 | C25193 lift effort is larger than the L sizing assumes | 3 | 3 | 9 | Mandatory Phase 2 entry spike (Section 6.4) produces a one-page scoping note before any helper is lifted. | QA Lead |
| R-13 | Walking skeleton selector breaks because no `data-testid` exists | 3 | 2 | 6 | Walking skeleton uses `getByRole('heading', { name: /dashboard/i })`. Re-validated at Phase 1 exit. | QA Automation |
| R-14 | Storage state expires between nightly runs | 4 | 3 | 12 | Storage-state freshness re-validation built into `auth.fixture.ts` in Phase 0 Step D. | QA Automation |
| R-15 | qa2 instability blocks Phase 0 walking skeleton | 3 | 4 | 12 | Decision D-23: TEST_ENV fallback to qa3 after two consecutive bad nights. | Platform lead |
| R-16 | Historical credential leak in git history is never resolved | 3 | 4 | 12 | Decision D-20 forces an explicit choice (rewrite vs. accept) at Phase 0 Step C. | Security |
| R-17 | Monorepo per-package CI matrix becomes unmanageable | 3 | 3 | 9 | Affected-package detection keeps PR-gate cost proportional; matrix generated dynamically. | QA Automation |
| R-18 | Scaffold script template rot | 3 | 4 | 12 | The scaffold-test CI workflow runs the script end-to-end on every PR touching the templates. `scaffold:doctor` lets existing teams detect drift. | QA Automation |
| R-19 | Cross-team Page Object promotion creates merge conflicts | 3 | 3 | 9 | Section 4.2.2 promotion rule; ESLint rule `no-cross-team-import` prevents the anti-pattern. | QA Lead |
| R-20 | Six empty team packages bit-rot before their teams write tests | 2 | 3 | 6 | The scaffold-generated smoke spec is *real*. `scaffold:doctor` is run quarterly. | QA Automation |
| R-21 | TypeScript path-alias footgun | 4 | 3 | 12 | Section 4.2.3.1 documents the pitfall; ESLint rule fails CI if a package's tsconfig is missing the block. | QA Automation |
| R-22 | Scaffold-test workflow secrets-injection misconfigured | 3 | 3 | 9 | Explicit secrets-injection contract documented in Phase 1 scope. | QA Automation |
| R-23 | Single-version drift across `packages/*/package.json` | 3 | 2 | 6 | `check-versions.ts` runs as a pre-commit hook and a CI lint check. | QA Automation |
| R-24 | Single framework breaking-change PR cascades and breaks every team package's nightly | 3 | 4 | 12 | Framework breaking-change discipline (D-39). | QA Lead |
| R-25 | Storage-state freshness re-validation overloads qa2's `/react/loginReact.do` | 3 | 3 | 9 | Per-worker (not per-test) re-validation; bounds extra HTTP volume. | QA Automation |
| R-26 | Bootstrap-vs-templates drift (D-34) | 2 | 4 | 8 | Phase 0 Step 0.G ships `verify-bootstrap-vs-templates.sh` that diffs the bootstrap against the templates on every PR. | QA Automation |

Highest-priority risks (score ≥ 12) — **R-11, R-02, R-07, R-06, R-10, R-14, R-15, R-16, R-18, R-21, R-24** — трябва да имат active mitigation owner преди Phase 0 да започне.

---

## 11. Open Items Checklist (Pre-Phase-0)

Прагматичен checklist, през който QA Lead-ът минава, преди да declare-не Phase 0 ready to start.

**Decisions (Section 7).** Phase 0 не може да започне, докато тези не са resolved:
- [ ] **D-01** TypeScript strict mode — DECIDED.
- [ ] **D-24** Monorepo with npm workspaces (supersedes D-04) — DECIDED.
- [ ] **D-25** POC area-to-team mapping (всички текущи POC → Billing & Servicing) — DECIDED.
- [ ] **D-26** Scaffold script as Phase 1 deliverable — DECIDED.
- [ ] **D-27** Single monorepo version — DECIDED.
- [ ] **D-28** npm workspaces (без pnpm/Turborepo/Nx initially) — DECIDED.
- [ ] **D-29** Phase 1 re-sized to L (2–3 weeks) acknowledged от Engineering Manager.
- [ ] **D-31** Legacy POC keeps `playwright.config.js` (no rename) — DECIDED.
- [ ] **D-34** Scaffold templates as source of truth от Phase 0 Step G — DECIDED.
- [ ] **D-35** Shim killed; legacy POC keeps duplicated JS helpers до Phase 5 sunset — DECIDED.
- [ ] **D-36** Framework `package.json` declares explicit `exports` field — DECIDED.
- [ ] **D-37** Phase 2 internal work order strict (Section 6.4.1) — DECIDED.
- [ ] **D-38** Single workspace-root ESLint flat config — DECIDED.
- [ ] **D-39** Framework breaking-change discipline — DECIDED.
- [ ] **D-40** `run-summary.json` schema version 1 — DECIDED.
- [ ] **D-41** Storage states shared at workspace root — DECIDED.
- [ ] **D-42** API client accepts `APIRequestContext`; no inline login — DECIDED.
- [ ] **D-43** Legacy-poc hoist policy — DECIDED.
- [ ] **D-44** Walking-skeleton selector reconnaissance complete (Phase 0 Step 0.0) — DECIDED.
- [ ] **D-07** TestRail Run 175 cadence agreed с Product — DECIDED.
- [ ] **D-11** Credential rotation owner committed (Security + QA Lead) — DECIDED.
- [ ] **D-22** Named Security counterpart confirmed в писмен вид — DECIDED.
- [ ] **D-19** Version pinning approved и `package-lock.json` policy accepted — DECIDED.
- [ ] **Program Owner** named (Section 6.14) — recorded в Phase 0 tracking issue.

**Decisions due преди по-късни phases** (трябва да имат owner + due date, не задължително decided):
- [ ] **D-03** Secret store — owner committed (блокира Phase 0 day-1 rotation).
- [ ] **D-02** CI platform — owner committed (блокира Phase 1).
- [ ] **D-08** `__REACT_QUERY_CLIENT__` exposure — owner committed (блокира Phase 2).
- [ ] **D-05** Frontend `data-testid` partner — owner committed (блокира Phase 3).
- [ ] **D-06** First migration scope — owner committed (блокира Phase 4).

**Dependencies (Section 8).**
- [ ] Confluence space създадено и linked от този документ.
- [ ] Existing committed credentials inventoried; Security има rotation plan.
- [ ] Engineering Manager е acknowledged second-contributor commitment-а (R-11 / M3) — **end of Phase 1**, блокирайки Phase 2 entry.

**Risks (Section 10).**
- [ ] Всички score-≥-12 risks (R-02, R-06, R-07, R-10, R-11) имат named mitigation owner, който е acknowledged в писмен вид.

**Operational.**
- [ ] Phase 0 tracking issue created с Section 6.2 exit criteria като checklist.
- [ ] Phase 0 kickoff meeting scheduled.
- [ ] Този документ linked от `MEMORY.md` и Confluence space-а.

---

## 12. Приложение — детайлен POC inventory

### 12.1 Текуща файлова структура

```
automation-geo-tests/
├── package.json                    # 10 npm scripts
├── playwright.config.js            # Worker-scoped workerFirm fixture (monkey-patched)
├── testrail.config.json            # Run 175, base URL (qa3), credentials (committed)
├── eslint.config.mjs               # ESLint 10 flat config + Playwright plugin
├── .prettierrc.json                # 100-char width, trailing comma es5
├── tests/
│   ├── _helpers/                   # 7 files, ~1200 LOC
│   │   ├── index.js                # Barrel re-export
│   │   ├── global-setup.js         # Storage state init
│   │   ├── qa3.js                  # Login, navigation, billing workflows (~400 LOC)
│   │   ├── ui.js                   # React widget primitives (~600 LOC)
│   │   ├── worker-firm.js          # Dummy firm provisioning + prospect cache (~300 LOC)
│   │   └── build-*.js              # XLSX builders
│   ├── .auth/tim1.json             # Storage state (gitignored)
│   ├── fixtures/                   # Static xlsx templates
│   ├── account-billing/            # 15 specs
│   ├── billing-specs/              # 4 specs
│   ├── bucket-exclusions/          # 13 specs
│   ├── create-account/             # 7 specs
│   ├── unmanaged-assets/           # 12 specs
│   └── platform-one/
│       ├── auto-link/              # 7 specs (all test.fixme)
│       └── merge-prospect/         # 8 specs
├── reporters/testrail-reporter.js  # ~180 LOC
└── scripts/                        # 9 utilities
```

### 12.2 Hybrid Isolation Model

| Phase | Pattern | Isolation | Risk |
|---|---|---|---|
| Phase 1 (write/read) | `workerFirm` (per-worker dummy firm) | Each worker owns its firm | Low |
| Phase 2 (read-only) | Static Firm 106 + `tyler@plimsollfp.com` | Shared across workers | None (read-only) |

Phase 1 беше migrated away от Firm 106 след parallel-load race condition: осем workers concurrently мутиращи същия Arnold/Delaney account.

### 12.3 GeoWealth Backend Surface (test-relevant)

- **Struts 2** със `.do` extension; namespaces: `/react`, `/bo`, `/qa`, `/portal`.
- **Login flow:** `POST /react/loginReact.do` → `ReactIndexAction.login()`.
- **QA endpoints (gated by `CommonGwAdminQaAction.canExecuteAction()`):**
  - `/qa/createDummyFirm.do` — firm + advisor + accounts (~6s)
  - `/qa/createInvitationToken.do` — onboarding tokens
  - `/qa/invalidateToken.do`
  - `/qa/importCustodianAccount.do`
  - `/qa/createCrntCostBasis*.do`
  - `/qa/executeMFs.do`
  - `/qa/simulateSchwabTransaction.do`
  - `/qa/uploadTPAMFile.do`
- **Auth:** session/cookie, `LoginInterceptor` на всеки request, multi-tenancy by `firmCd`.
- **React routes:** hash-based (`#/login`, `#/advisors`, `#/accounts`), lazy-loaded modules.
- **Domain core:** Firm → Advisor/Client → Account → Custodian/Instrument; Strategy/Model; AccessSet/Role.

---

## 13. История на ревизиите

> Тази секция отразява историята на английския canonical документ. Българският превод следва v1.2.

| Версия | Дата | Автор | Бележки |
|---|---|---|---|
| 0.1–1.2 | 2026-04-09 | QA Automation | Виж английския оригинал `OFFICIAL-FRAMEWORK-PROPOSAL.md` за пълната revision history (12 итерации, 6 рунда дълбочинна критика, monorepo restructure, post-monorepo hardening, kill the broken shim, clean shim aftermath). |
| BG 1.2 | 2026-04-09 | QA Automation | Български паралелен превод на v1.2; canonical остава английският документ. |

