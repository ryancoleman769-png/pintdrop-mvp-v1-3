(function () {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const state = {
    pubs: [],
    handoffUrl: ""
  };

  function show(element, visible = true) {
    if (element) element.classList.toggle("hidden", !visible);
  }

  function setMessage(element, message) {
    if (!element) return;
    element.textContent = message || "";
    show(element, Boolean(message));
  }

  async function request(url, options = {}) {
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.headers || {})
      }
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok || data.ok === false) {
      const error = new Error(data.error || "Something went wrong. Please try again.");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function selectedPub() {
    const id = Number(byId("pubId")?.value);
    return state.pubs.find((pub) => Number(pub.id) === id) || null;
  }

  function populateFromPub() {
    const pub = selectedPub();
    const hint = byId("pubHint");
    if (!pub) {
      if (hint) hint.textContent = "Choose the pub that needs help with Stripe payouts.";
      return;
    }

    if (hint) {
      const status = pub.onboardingStatus.replace(/_/g, " ");
      hint.textContent = `Pub #${pub.id} · PintDrop status: ${status}`;
    }
    if (!byId("businessEmail").value && pub.contactEmail) {
      byId("businessEmail").value = pub.contactEmail;
    }
    if (!byId("businessPhone").value && pub.contactPhone) {
      byId("businessPhone").value = pub.contactPhone;
    }
    if (!byId("businessCity").value && pub.location) {
      byId("businessCity").value = pub.location;
    }
  }

  function renderPubOptions() {
    const select = byId("pubId");
    if (!select) return;
    select.replaceChildren();

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = state.pubs.length ? "Choose a pub…" : "No pubs available";
    select.appendChild(placeholder);

    state.pubs.forEach((pub) => {
      const option = document.createElement("option");
      option.value = String(pub.id);
      const location = pub.location ? ` — ${pub.location}` : "";
      option.textContent = `#${pub.id} ${pub.name}${location}`;
      select.appendChild(option);
    });
  }

  async function loadPubs() {
    const data = await request("/api/admin/pubs", { method: "GET" });
    state.pubs = Array.isArray(data.pubs) ? data.pubs : [];
    renderPubOptions();
  }

  function updateBusinessType() {
    const company = byId("businessType").value === "company";
    show(byId("legalNameField"), company);
    byId("legalName").required = company;
  }

  function showLogin() {
    show(byId("adminLoginCard"), true);
    show(byId("adminWorkspace"), false);
  }

  async function showWorkspace() {
    show(byId("adminLoginCard"), false);
    show(byId("adminWorkspace"), true);
    try {
      await loadPubs();
    } catch (error) {
      if (error.status === 401) {
        showLogin();
        return;
      }
      setMessage(byId("assistedSetupError"), error.message);
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    setMessage(byId("adminLoginError"), "");
    const button = byId("adminLoginButton");
    button.disabled = true;
    button.textContent = "Signing in…";
    try {
      await request("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({
          key: byId("adminPassword").value,
          password: byId("adminPassword").value
        })
      });
      byId("adminPassword").value = "";
      await showWorkspace();
    } catch (error) {
      setMessage(byId("adminLoginError"), error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Open assisted setup";
    }
  }

  async function handleLogout() {
    try {
      await request("/api/admin/logout", { method: "POST" });
    } finally {
      showLogin();
    }
  }

  function fillTestDetails() {
    byId("businessType").value = "company";
    updateBusinessType();
    byId("legalName").value = "PintDrop Preview Pub Limited";
    byId("representativeFirstName").value = "Ava";
    byId("representativeLastName").value = "Murphy";
    byId("representativeDob").value = "1985-01-15";
    byId("businessEmail").value = "owner@example.com";
    byId("businessPhone").value = "+353871234567";
    byId("addressLine1").value = "1 Main Street";
    byId("addressLine2").value = "";
    byId("businessCity").value = selectedPub()?.location || "Buncrana";
    byId("postalCode").value = "F93 X123";
    byId("accountHolderName").value = "PintDrop Preview Pub Limited";
    byId("iban").value = "IE29 AIBK 9311 5212 3456 78";
  }

  function formPayload(form) {
    const data = Object.fromEntries(new FormData(form).entries());
    return {
      ...data,
      pubId: Number(data.pubId)
    };
  }

  function renderResult(data) {
    state.handoffUrl = String(data.handoffUrl || "");
    byId("handoffPubName").textContent = `${data.pub.name} is ready`;
    byId("handoffSummary").textContent = `Stripe test account prepared. IBAN ending ${data.ibanLast4}. Send the link below to the pub owner.`;
    byId("handoffUrl").value = state.handoffUrl;
    byId("openHandoffLink").href = state.handoffUrl;
    setMessage(byId("handoffWarning"), data.warning || "");
    show(byId("shareHandoffButton"), Boolean(navigator.share));
    show(byId("handoffResult"), true);
    byId("handoffResult").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleAssistedSetup(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setMessage(byId("assistedSetupError"), "");
    show(byId("handoffResult"), false);

    if (!form.reportValidity()) return;

    const button = byId("assistedSetupButton");
    button.disabled = true;
    button.textContent = "Preparing Stripe test account…";
    try {
      const data = await request("/api/admin/assisted-connect", {
        method: "POST",
        body: JSON.stringify(formPayload(form))
      });
      byId("iban").value = "";
      renderResult(data);
    } catch (error) {
      if (error.status === 401) {
        showLogin();
        return;
      }
      setMessage(byId("assistedSetupError"), error.message);
    } finally {
      button.disabled = false;
      button.textContent = "Prepare secure pub handoff";
    }
  }

  async function copyHandoff() {
    if (!state.handoffUrl) return;
    const button = byId("copyHandoffButton");
    try {
      await navigator.clipboard.writeText(state.handoffUrl);
    } catch {
      byId("handoffUrl").focus();
      byId("handoffUrl").select();
      document.execCommand("copy");
    }
    button.textContent = "Copied ✓";
    window.setTimeout(() => { button.textContent = "Copy link"; }, 1800);
  }

  async function shareHandoff() {
    if (!navigator.share || !state.handoffUrl) return;
    const pub = selectedPub();
    try {
      await navigator.share({
        title: "Complete your PintDrop payout setup",
        text: `Hi, here is the secure PintDrop setup link for ${pub?.name || "your pub"}.`,
        url: state.handoffUrl
      });
    } catch (error) {
      if (error?.name !== "AbortError") {
        setMessage(byId("handoffWarning"), "The share sheet could not open. You can copy the link instead.");
      }
    }
  }

  async function initialise() {
    byId("adminLoginForm").addEventListener("submit", handleLogin);
    byId("adminLogoutButton").addEventListener("click", handleLogout);
    byId("pubId").addEventListener("change", populateFromPub);
    byId("businessType").addEventListener("change", updateBusinessType);
    byId("fillTestDetails").addEventListener("click", fillTestDetails);
    byId("assistedSetupForm").addEventListener("submit", handleAssistedSetup);
    byId("copyHandoffButton").addEventListener("click", copyHandoff);
    byId("shareHandoffButton").addEventListener("click", shareHandoff);
    updateBusinessType();

    try {
      const session = await request("/api/admin/session", { method: "GET" });
      if (session.authenticated) {
        await showWorkspace();
      } else {
        showLogin();
      }
    } catch {
      showLogin();
    }
  }

  initialise();
})();
