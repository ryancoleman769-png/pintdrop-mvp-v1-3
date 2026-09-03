(() => {
  const loginPanel = document.getElementById("adminLoginPanel");
  const dashboard = document.getElementById("adminDashboard");
  const logoutBtn = document.getElementById("adminLogoutBtn");
  const loginForm = document.getElementById("adminLoginForm");
  const loginError = document.getElementById("adminLoginError");
  const loadError = document.getElementById("adminLoadError");
  const statusMessage = document.getElementById("adminStatusMessage");
  const filterForm = document.getElementById("adminFilterForm");
  const pubSelect = document.getElementById("adminFilterPub");
  const fromInput = document.getElementById("adminFilterFrom");
  const toInput = document.getElementById("adminFilterTo");
  const statusSelect = document.getElementById("adminFilterStatus");
  const stripeSelect = document.getElementById("adminFilterStripe");
  const exportBtn = document.getElementById("adminExportCsvBtn");
  const tableBody = document.getElementById("adminTransactionsBody");
  const overallEl = document.getElementById("adminOverallTotals");
  const dailyEl = document.getElementById("adminDailyTotals");
  const weeklyEl = document.getElementById("adminWeeklyTotals");
  const pubTotalsEl = document.getElementById("adminPubTotals");

  function money(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "€0.00";
    return `€${amount.toFixed(2)}`;
  }

  function show(el, visible) {
    if (!el) return;
    el.classList.toggle("hidden", !visible);
  }

  function setText(el, text, isError) {
    if (!el) return;
    el.textContent = text || "";
    show(el, Boolean(text));
    if (isError != null) el.classList.toggle("admin-error", isError);
  }

  async function adminFetch(url, options = {}) {
    const response = await fetch(url, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    return { response, data };
  }

  function currentFilters() {
    return {
      pubId: pubSelect.value || "",
      from: fromInput.value || "",
      to: toInput.value || "",
      status: statusSelect.value || "all",
      stripeMode: stripeSelect.value || "all"
    };
  }

  function filterQuery(extra = {}) {
    const filters = { ...currentFilters(), ...extra };
    const params = new URLSearchParams();
    if (filters.pubId) params.set("pubId", filters.pubId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.status && filters.status !== "all") params.set("status", filters.status);
    if (filters.stripeMode && filters.stripeMode !== "all") params.set("stripeMode", filters.stripeMode);
    const query = params.toString();
    return query ? `?${query}` : "";
  }

  function fillPubSelect(pubs, selectedId) {
    const current = selectedId == null ? pubSelect.value : String(selectedId);
    pubSelect.innerHTML = `<option value="">All pubs</option>` + (pubs || []).map((pub) => (
      `<option value="${pub.id}">${escapeHtml(pub.name)}</option>`
    )).join("");
    if (current && [...pubSelect.options].some((option) => option.value === current)) {
      pubSelect.value = current;
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function totalsLine(item, label) {
    return `<p><strong>${escapeHtml(label)}</strong> · ${item.count} · drink ${money(item.drinkValue)} · fee ${money(item.serviceFee)} · total ${money(item.total)}</p>`;
  }

  function renderTotals(totals) {
    const overall = totals?.overall || { count: 0, drinkValue: 0, serviceFee: 0, total: 0 };
    overallEl.innerHTML = totalsLine(overall, "Selected range");
    dailyEl.innerHTML = (totals?.daily || []).length
      ? totals.daily.map((row) => totalsLine(row, row.date)).join("")
      : "<p>No daily totals.</p>";
    weeklyEl.innerHTML = (totals?.weekly || []).length
      ? totals.weekly.map((row) => totalsLine(row, row.label || row.week)).join("")
      : "<p>No weekly totals.</p>";
    pubTotalsEl.innerHTML = (totals?.pubs || []).length
      ? totals.pubs.map((row) => totalsLine(row, row.pubName)).join("")
      : "<p>No pub totals.</p>";
  }

  function renderRows(rows) {
    if (!rows.length) {
      tableBody.innerHTML = `<tr><td colspan="10">No transactions for these filters.</td></tr>`;
      return;
    }
    tableBody.innerHTML = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.createdAtLabel)}</td>
        <td>${escapeHtml(row.pubName)}</td>
        <td><code>${escapeHtml(row.code)}</code></td>
        <td>${escapeHtml(row.drinkName)}</td>
        <td>${money(row.drinkValue)}</td>
        <td>${money(row.serviceFee)}</td>
        <td>${money(row.total)}</td>
        <td><span class="admin-status admin-status--${row.status.toLowerCase()}">${escapeHtml(row.status)}</span></td>
        <td>${escapeHtml(row.redeemedAtLabel || "—")}</td>
        <td class="admin-session-id">${escapeHtml(row.stripeCheckoutSessionId || "—")}</td>
      </tr>
    `).join("");
  }

  function showLogin() {
    show(loginPanel, true);
    show(dashboard, false);
    show(logoutBtn, false);
  }

  function showDashboard() {
    show(loginPanel, false);
    show(dashboard, true);
    show(logoutBtn, true);
  }

  async function loadTransactions() {
    setText(loadError, "");
    const { response, data } = await adminFetch(`/api/admin/transactions${filterQuery()}`);
    if (response.status === 401) {
      showLogin();
      return;
    }
    if (!response.ok || !data.ok) {
      setText(loadError, data.error || "Could not load transactions.", true);
      return;
    }
    fillPubSelect(data.pubs || []);
    renderTotals(data.totals);
    renderRows(data.rows || []);
    setText(
      statusMessage,
      data.truncated ? "Showing the most recent 2,000 matching rows." : `${(data.rows || []).length} transaction(s).`,
      false
    );
  }

  async function checkSession() {
    const { data } = await adminFetch("/api/admin/session");
    if (data?.authenticated) {
      showDashboard();
      await loadTransactions();
      return;
    }
    showLogin();
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setText(loginError, "");
    const password = document.getElementById("adminPassword").value;
    const { response, data } = await adminFetch("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ password })
    });
    if (!response.ok || !data.ok) {
      setText(loginError, data.error || "Could not sign in.", true);
      return;
    }
    document.getElementById("adminPassword").value = "";
    showDashboard();
    await loadTransactions();
  });

  logoutBtn.addEventListener("click", async () => {
    await adminFetch("/api/admin/logout", { method: "POST", body: "{}" });
    showLogin();
  });

  filterForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await loadTransactions();
  });

  exportBtn.addEventListener("click", () => {
    window.location.href = `/api/admin/transactions.csv${filterQuery()}`;
  });

  void checkSession();
})();

