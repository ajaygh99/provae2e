# Mnemox Testing - Actual qe-tool Commands
**Real commands for real URLs and APIs**

---

## 🎯 Your Mnemox Setup

**Web App:** https://www.mnemoxpro.com/
**API:** Available (Supabase backend)
**Vector DB:** Qdrant
**Embeddings:** OpenAI API
**Extensions:** Chrome Web Store

---

## ✅ CORRECT qe-tool Commands

### 1. Test Web App (Browser Testing)

```powershell
cd C:\Users\ajjuk\Documents\Cowork\Provae2e

# Quick smoke test - Check app loads
qe-tool run --url "https://www.mnemoxpro.com" `
  --type browser `
  --scope smoke `
  --report

# Full browser testing
qe-tool run --url "https://www.mnemoxpro.com" `
  --type browser `
  --scope full `
  --workers 3 `
  --report

# Mobile emulation test
qe-tool run --url "https://www.mnemoxpro.com" `
  --type mobile `
  --device "iPhone14" `
  --scope full `
  --report

# Mobile + Browser together
qe-tool run --url "https://www.mnemoxpro.com" `
  --type browser,mobile `
  --device "iPhone14,Pixel7" `
  --workers 4 `
  --ai `
  --report
```

---

### 2. Test Mnemox API

**First, get your API credentials:**
- API Key from https://www.mnemoxpro.com/settings/api
- Base URL: Check your Supabase project

```powershell
# Test API authentication
qe-tool run --url "https://api.mnemoxpro.com" `
  --type api `
  --method GET `
  --headers '{"Authorization":"Bearer YOUR_API_KEY"}' `
  --expect-status 200 `
  --report

# Test memory creation (POST)
qe-tool run --url "https://api.mnemoxpro.com/api/memories" `
  --type api `
  --method POST `
  --headers '{"Authorization":"Bearer YOUR_API_KEY","Content-Type":"application/json"}' `
  --body '{"title":"Test Memory","content":"This is a test","tags":["test"]}' `
  --expect-status 201 `
  --report

# Test memory search (GET with query)
qe-tool run --url "https://api.mnemoxpro.com/api/memories/search" `
  --type api `
  --method GET `
  --headers '{"Authorization":"Bearer YOUR_API_KEY"}' `
  --expect-status 200 `
  --report

# Test API performance
qe-tool run --url "https://api.mnemoxpro.com" `
  --type api `
  --scope full `
  --timeout 5000 `
  --report
```

---

### 3. Test Chrome Extensions

```powershell
# Test Mnemox Universal Memory extension
qe-tool run --url "https://chromewebstore.google.com/detail/mnemox-universal-ai-mem/oningjpokiajciealpkkofdldcmnnfbf" `
  --type browser `
  --scope smoke `
  --report

# Test Mnemox Extension
qe-tool run --url "https://chromewebstore.google.com/detail/mnemox-extension/ebgobnpgohhdffehpdljbpbmbjobklcm" `
  --type browser `
  --scope smoke `
  --report
```

---

### 4. Full BETA Test Suite (Recommended)

```powershell
# Run everything: web app + API + mobile + AI analysis
qe-tool run --url "https://www.mnemoxpro.com" `
  --type all `
  --device "iPhone14,Pixel7" `
  --scope full `
  --workers 4 `
  --ai `
  --retries 2 `
  --report

# Output: test-results/report-*.html
```

---

## 📋 Test Scenarios to Run

### Scenario 1: Quick Smoke Test (5 min)
```powershell
qe-tool run --url "https://www.mnemoxpro.com" --type browser --scope smoke --report
```
**Tests:** App loads, login works, basic navigation

---

### Scenario 2: User Workflows (15 min)
```powershell
qe-tool run --url "https://www.mnemoxpro.com" `
  --type browser `
  --scope component `
  --report
```
**Tests:** Create memory, search, tags, sharing

---

### Scenario 3: API Integration (10 min)
```powershell
qe-tool run --url "https://api.mnemoxpro.com" `
  --type api `
  --scope full `
  --timeout 5000 `
  --report
```
**Tests:** CRUD operations, search, embeddings, vector DB

---

### Scenario 4: Mobile Experience (15 min)
```powershell
qe-tool run --url "https://www.mnemoxpro.com" `
  --type mobile `
  --device "iPhone14,Pixel7" `
  --scope full `
  --report
```
**Tests:** Responsive design, touch gestures, performance

---

### Scenario 5: Full Test with AI (30 min)
```powershell
qe-tool run --url "https://www.mnemoxpro.com" `
  --type all `
  --scope full `
  --workers 4 `
  --ai `
  --retries 2 `
  --report
```
**Tests:** Everything + Ollama AI failure analysis

---

## 🔧 Setup Before Running Tests

### 1. Get Your API Key
```
1. Go to https://www.mnemoxpro.com/settings/api
2. Copy your API key
3. Use it in headers: Authorization: Bearer YOUR_KEY
```

### 2. Check Your Backend URLs
```
API Base URL: https://api.mnemoxpro.com (or your Supabase URL)
Vector DB: Qdrant endpoint
OpenAI API: Configured in backend
```

### 3. Install Playwright Browsers (if not already done)
```powershell
npx playwright install chromium firefox webkit
```

---

## 📊 Expected Results After Testing

### Web App Tests Should Verify:
✅ Login/authentication works
✅ Memory creation works
✅ Search finds memories
✅ Tags organize properly
✅ AI summaries generate
✅ Sharing works
✅ Mobile responsive
✅ Performance <2s load time

### API Tests Should Verify:
✅ Authentication (API key validation)
✅ Create memory (POST 201)
✅ Read memory (GET 200)
✅ Update memory (PUT 200)
✅ Delete memory (DELETE 204)
✅ Search with Qdrant vectors
✅ OpenAI embeddings working
✅ Rate limiting in place

### Mobile Tests Should Verify:
✅ Responsive on iPhone14
✅ Responsive on Pixel7
✅ Touch gestures work
✅ Performance on mobile
✅ Sync with desktop

---

## 🚀 Recommended Test Order

### Day 1: Quick Validation
```powershell
# 5 minutes
qe-tool run --url "https://www.mnemoxpro.com" --type browser --scope smoke --report
```

### Day 2: API Integration
```powershell
# 10 minutes
qe-tool run --url "https://api.mnemoxpro.com" --type api --scope full --report
```

### Day 3: Mobile Testing
```powershell
# 15 minutes
qe-tool run --url "https://www.mnemoxpro.com" --type mobile --device "iPhone14,Pixel7" --scope full --report
```

### Day 4: Full Suite
```powershell
# 30 minutes
qe-tool run --url "https://www.mnemoxpro.com" --type all --scope full --workers 4 --ai --report
```

---

## 📈 Reports Generated

After each `qe-tool run`, reports are saved to:
```
test-results/report-[timestamp].html
```

**Reports include:**
- ✅ Pass/fail summary
- 📊 Test timeline
- 🖼️ Screenshots of failures
- 🎥 Video recordings
- 📉 Performance metrics
- 🤖 AI failure analysis (if --ai enabled)

---

## 🆘 Common Issues & Fixes

### Issue: "URL not found"
```
Solution: Check URL is accessible
qe-tool run --url "https://www.mnemoxpro.com" --scope smoke --report
```

### Issue: "API 401 Unauthorized"
```
Solution: Add correct API key in headers
--headers '{"Authorization":"Bearer YOUR_ACTUAL_API_KEY"}'
```

### Issue: "Timeout waiting for app"
```
Solution: Increase timeout
--timeout 10000
```

### Issue: "Mobile device not found"
```
Solution: Use correct device name
--device "iPhone14"  (not "iPhone 14")
--device "Pixel7"    (not "Pixel 7")
```

---

## 🎯 Next Steps

1. **Run smoke test first**
   ```powershell
   qe-tool run --url "https://www.mnemoxpro.com" --type browser --scope smoke --report
   ```

2. **Check reports**
   ```
   Open: test-results/report-*.html
   ```

3. **Run full suite**
   ```powershell
   qe-tool run --url "https://www.mnemoxpro.com" --type all --scope full --workers 4 --ai --report
   ```

4. **Fix any failures**
   - Check error logs
   - Review AI analysis
   - Fix bugs
   - Re-run tests

5. **Generate BETA feedback report**
   ```
   Results → qa/run-results.md
   ```

---

**Ready to test Mnemox! 🚀**
