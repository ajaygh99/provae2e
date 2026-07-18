# PROVA Product Roadmap
# Approved: June 2026

## Phase 1 — MVP (Weeks 1-10, $21.25/month)
**Goal: First 3 paying customers**
- Browser testing (Playwright headless Chromium/WebKit/Firefox)
- Mobile browser emulation (30+ devices via Playwright)
- API testing (REST + GraphQL via Playwright network)
- CLI: qe-tool run with --url --type --device --workers --report
- Self-healing selectors (5-tier fallback hierarchy)
- HTML reports (Allure)
- Ollama AI summaries (--ai flag, local, $0)
- GitHub Actions drop-in config
- npm publish @provae2e/cli
- Target: AI startups (YC batches, Product Hunt, X/Twitter)
- Pricing: Free (100 runs/mo) | Starter $29 | Team $79

## Phase 2 — Intelligence (Month 3-6)
**Goal: 20 paying customers, product-market fit**
- JIRA connector + AC extraction
- Basic AI test generation from specs
- Test data factory (self-service, schema-aware)
- Figma screen ingestion (basic)
- Multi-environment gates (dev→qe→staging)
- Performance baseline monitoring (K6 integration)

## Phase 3 — Platform (Month 6-12)
**Goal: $5k MRR, first enterprise customer**
- PROVA Studio (codeless web UI for POs and BAs)
- Full Golden Thread traceability (7-stage chain)
- Production monitoring (PROVA Sentinel, 5 layers)
- Mobile native testing (Appium)
- Security testing (OWASP ZAP)
- Full knowledge graph (4-source: GHE + JIRA + Design + DB)

## Phase 4 — Enterprise (Month 12-24)
**Goal: $10k MRR, Series A readiness**
- LLM/AI feature testing (hallucination detection)
- Compliance automation (GDPR/HIPAA/PCI)
- PROVA Chat (conversational QE in Slack/Teams)
- ERP/mainframe connectors
- Advanced multi-environment orchestration
- White-label offering for resellers

## Competitor Benchmark
- ACCELQ: PROVA wins 34/37 features (0 ACCELQ wins)
- Selenium: PROVA wins 38/40 features (tie: license cost)
- Score: 9.5/10 current → 10/10 at Month 24
