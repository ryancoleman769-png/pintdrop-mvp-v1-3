(function () {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  const returnState = params.get("state") || "";

  function show(element, visible = true) {
    if (element) element.classList.toggle("hidden", !visible);
  }

  function setError(message) {
    const element = byId("handoffActionError");
    element.textContent = message || "";
    show(element, Boolean(message));
  }

  async function request(url) {
    const response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || "This secure setup link could not be opened.");
    }
    return data;
  }

  function showInvalid(message) {
    show(byId("handoffLoading"), false);
    show(byId("handoffReady"), false);
    show(byId("handoffComplete"), false);
    byId("handoffInvalidMessage").textContent = message;
    show(byId("handoffInvalid"), true);
  }

  function renderReady(data) {
    const location = data.pub.location ? ` · ${data.pub.location}` : "";
    byId("handoffPubName").textContent = data.pub.name;
    byId("handoffPubLocation").textContent = location;
    if (returnState === "return") {
      byId("handoffStatusText").textContent = data.detailsSubmitted
        ? "Stripe received your details and is checking the test account."
        : "There are still a few details to finish with Stripe.";
      byId("continueToStripeButton").textContent = "Continue Stripe setup";
    }
    show(byId("handoffLoading"), false);
    show(byId("handoffReady"), true);
  }

  function renderComplete(data) {
    byId("completePubName").textContent = data.pub.name;
    show(byId("handoffLoading"), false);
    show(byId("handoffReady"), false);
    show(byId("handoffComplete"), true);
  }

  async function continueToStripe() {
    const button = byId("continueToStripeButton");
    setError("");
    button.disabled = true;
    button.textContent = "Opening Stripe…";
    try {
      const data = await request("/api/stripe-connect/handoff-link");
      window.location.assign(data.url);
    } catch (error) {
      setError(error.message);
      button.disabled = false;
      button.textContent = "Try Stripe setup again";
    }
  }

  async function initialise() {
    byId("continueToStripeButton").addEventListener("click", continueToStripe);
    if (!token) {
      showInvalid("This setup link is missing its secure token. Ask PintDrop for a new link.");
      return;
    }

    try {
      const data = await request("/api/stripe-connect/handoff-status");
      if (data.status === "complete") {
        renderComplete(data);
        return;
      }
      renderReady(data);
      if (returnState === "refresh") {
        await continueToStripe();
      }
    } catch (error) {
      showInvalid(error.message);
    }
  }

  initialise();
})();
