const $ = (id) => document.getElementById(id);
const statusLabel = {
  ok: "Ready for review", pending: "Ready for review", needs_review: "Needs review",
  needs_verification: "Needs verification", confirmed: "Confirmed"
};
const priorityLabel = { urgent: "Urgent", unread: "Unread", watch: "Watch", routine: "Routine" };
const uploadedSources = new Map();
let currentReports = [];
let activeWorkspace = "";
let openedReport = "";
let selectedHeat = null;
let queuePage = 0;
const queuePageSize = 9;
let patientRequest = 0;
let patientDirectory = [];
let selectedPatientId = "";

async function api(path, options) {
  const response = await fetch("/api/" + path, options);
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    const error = new Error(data?.error ?? "Flask returned HTTP " + response.status + ".");
    error.status = response.status;
    throw error;
  }
  return data;
}

function node(tag, text) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  return element;
}

function reading(test) {
  if (!test) return "No readable test value";
  const result = [test.value, test.unit].filter(value => value != null && value !== "").join(" ");
  const range = test.range_low != null && test.range_high != null
    ? " (printed range " + test.range_low + "–" + test.range_high + ")" : "";
  return test.name + " · " + (result || "unreadable") + range;
}

function reportName(report) {
  return report.patient_name ?? "Unmatched report #" + report.id;
}

function reportSource(report, onReady = () => {}) {
  const box = node("div");
  box.className = "source-attachment";
  const note = node("p", "Original unavailable here. Check the screenshot from the intake channel.");
  note.className = "source-note";
  box.append(note);
  const sessionSource = uploadedSources.get(report.id);
  let source = sessionSource;
  if (!source && report.image_url) {
    try {
      const candidate = new URL(report.image_url, location.origin);
      if (candidate.protocol === "https:" || candidate.protocol === "http:") source = candidate.href;
    } catch { /* Keep the missing-source message for invalid URLs. */ }
  }
  if (!source) {
    onReady();
    return box;
  }
  note.textContent = "Original report";
  const image = node("img");
  image.className = "source-image";
  image.alt = "Original lab report screenshot";
  image.loading = "lazy";
  const zoom = node("a", "Open full-size original ↗");
  zoom.className = "source-open";
  zoom.href = source;
  zoom.target = "_blank";
  zoom.rel = "noopener";
  image.addEventListener("load", onReady, { once: true });
  image.addEventListener("error", () => {
    image.hidden = zoom.hidden = true;
    note.textContent = "The image could not load. Check the screenshot from the intake channel.";
    onReady();
  }, { once: true });
  image.src = source;
  box.append(image, zoom);
  return box;
}

function renderReport(report) {
  const row = $("report-template").content.firstElementChild.cloneNode(true);
  row.id = "report-" + report.id;
  row.querySelector("h3").textContent = reportName(report);
  const priority = row.querySelector(".priority");
  priority.textContent = priorityLabel[report.level] ?? "Unranked";
  priority.dataset.level = report.level;
  const timestamp = new Date(report.received_at);
  const date = report.received_at && !Number.isNaN(timestamp.getTime()) ? timestamp.toLocaleString() : "";
  row.querySelector(".metadata").textContent = [report.source, statusLabel[report.status], date]
    .filter(Boolean).join(" · ");
  row.querySelector(".finding").textContent = reading(report.worst);
  const review = row.querySelector("input");
  const confirm = row.querySelector(".confirm");
  review.disabled = true;
  row.querySelector(".source-attachment").replaceWith(reportSource(report, () => { review.disabled = false; }));
  const values = row.querySelector(".review-reading");
  values.append(node("h4","Extracted values"),node("p",reading(report.worst)));
  const details = row.querySelector("details");
  if (report.patient_id) {
    details.addEventListener("toggle", async () => {
      if (!details.open || details.dataset.valuesLoaded) return;
      details.dataset.valuesLoaded = "true";
      try {
        const patient = await api("patients/" + encodeURIComponent(report.patient_id));
        const tests = patient.reports?.find(item => item.id === report.id)?.tests;
        if (!tests?.length) return;
        const list = node("ul");
        for (const test of tests) list.append(node("li",reading(test)));
        values.replaceChildren(node("h4","Extracted values"),list);
      } catch {
        delete details.dataset.valuesLoaded;
      }
    });
  }
  review.closest("label").hidden = confirm.hidden = report.status === "confirmed";
  review.addEventListener("change", () => { confirm.disabled = !review.checked; });
  confirm.addEventListener("click", async () => {
    if (!review.checked) return;
    confirm.disabled = review.disabled = true;
    const message = row.querySelector(".confirm-message");
    message.textContent = "Confirming…";
    try {
      await api("reports/" + report.id + "/confirm", { method: "POST" });
      message.textContent = "Reading confirmed.";
      confirm.hidden = review.closest("label").hidden = true;
      await Promise.all([loadInbox(), loadPatient(selectedPatientId)]);
    } catch (error) {
      message.textContent = error.message;
      confirm.disabled = review.disabled = false;
    }
  });
  if (report.caption) row.insertBefore(node("p", report.caption), row.querySelector("details"));
  return row;
}

function renderInbox() {
  const pendingOnly = $("pending-only").checked;
  const listed = pendingOnly ? currentReports.filter(report => report.status !== "confirmed") : currentReports;
  const pages = Math.ceil(listed.length / queuePageSize);
  const requested = new URLSearchParams(location.search).get("report");
  if (activeWorkspace === "review" && requested && requested !== openedReport) {
    const index = listed.findIndex(report => String(report.id) === requested);
    if (index >= 0) queuePage = Math.floor(index / queuePageSize);
  }
  queuePage = Math.max(0, Math.min(queuePage, pages - 1));
  const visible = listed.slice(queuePage * queuePageSize, (queuePage + 1) * queuePageSize);
  $("queue").replaceChildren(...visible.map(renderReport));
  $("queue-message").textContent = listed.length
    ? listed.length + " reports · Highest priority first"
    : pendingOnly ? "No reports awaiting review." : "No reports yet.";
  $("queue-pages").hidden = pages <= 1;
  $("queue-page").textContent = "Page " + (queuePage + 1) + " of " + pages;
  $("queue-prev").disabled = queuePage === 0;
  $("queue-next").disabled = queuePage + 1 >= pages;
}

const heatLevels = { urgent: "Urgent", unread: "Unread", watch: "Watch", routine: "Routine", other: "Unranked" };

function previewHeat(report) {
  const link = $("heat-open");
  link.hidden = !report;
  if (!report) {
    $("heat-selection").textContent = "No reports in the inbox yet.";
    return;
  }
  const priority = priorityLabel[report.level] ?? "Unranked";
  $("heat-selection").textContent = [reportName(report), priority, reading(report.worst)].join(" · ");
  link.href = "/nabz/clinic.html?view=review&report=" + encodeURIComponent(report.id);
}

function renderHeatmap() {
  const rows = $("heatmap-rows");
  rows.replaceChildren();
  selectedHeat = currentReports.find(report => report.id === selectedHeat?.id) ?? currentReports[0] ?? null;
  for (const [level, label] of Object.entries(heatLevels)) {
    const reports = currentReports.filter(report => (priorityLabel[report.level] ? report.level : "other") === level);
    if (!reports.length && level === "other") continue;
    const row = node("div");
    row.className = "heat-row";
    row.dataset.level = level;
    const key = node("span", label + " (" + reports.length + ")");
    key.className = "heat-key";
    const tiles = node("div");
    tiles.className = "heat-tiles";
    for (const report of reports) {
      const button = node("button");
      button.type = "button";
      button.className = "heat-tile";
      button.setAttribute("aria-label", label + " report for " + reportName(report));
      button.setAttribute("aria-pressed", String(report.id === selectedHeat?.id));
      button.addEventListener("pointerenter", () => previewHeat(report));
      button.addEventListener("pointerleave", () => previewHeat(selectedHeat));
      button.addEventListener("focus", () => previewHeat(report));
      button.addEventListener("click", () => {
        selectedHeat = report;
        for (const tile of rows.querySelectorAll("button")) tile.setAttribute("aria-pressed", String(tile === button));
        previewHeat(report);
      });
      tiles.append(button);
    }
    row.append(key, tiles);
    rows.append(row);
  }
  previewHeat(selectedHeat);
}

function openReportFromLink() {
  const id = new URLSearchParams(location.search).get("report");
  if (!id || openedReport === id) return;
  const row = $("report-" + id);
  if (!row) return;
  openedReport = id;
  const details = row.querySelector("details");
  details.open = true;
  row.scrollIntoView({ block: "center" });
  details.querySelector("summary").focus({ preventScroll: true });
}

async function loadInbox() {
  $("refresh").disabled = $("heat-refresh").disabled = true;
  $("queue-message").textContent = "Loading reports…";
  try {
    currentReports = await api("inbox");
    renderInbox();
    if(activeWorkspace === "overview")renderHeatmap();
    if(activeWorkspace === "review")openReportFromLink();
  } catch (error) {
    $("heat-selection").textContent = "Could not load clinic reports.";
    $("queue-message").textContent = "Could not load the queue. " + error.message;
  } finally {
    $("refresh").disabled = $("heat-refresh").disabled = false;
  }
}

function renderPatientMatches() {
  const query = $("patient-search").value.trim().toLowerCase();
  const matches = patientDirectory.filter(patient => patient.name.toLowerCase().includes(query));
  const grid = $("patient-matches");
  grid.replaceChildren();
  const shown = matches.slice(0, 12);
  for (const patient of shown) {
    const option = node("button", patient.name);
    option.type = "button";
    option.setAttribute("aria-pressed", String(String(patient.id) === selectedPatientId));
    option.addEventListener("click", () => {
      $("patient-picker").open = false;
      $("patient-picker").querySelector("summary").focus();
      const url = new URL(location.href);
      url.searchParams.set("patient", patient.id);
      history.replaceState({}, "", url);
      loadPatient(String(patient.id));
    });
    grid.append(option);
  }
  $("patient-search-status").textContent = matches.length > shown.length
    ? shown.length + " of " + matches.length + " patients. Search to narrow the results."
    : matches.length ? "" : "No matching patients.";
}

async function loadPatients() {
  try {
    patientDirectory = await api("patients");
    patientDirectory.sort((a, b) => a.name.localeCompare(b.name));
    renderPatientMatches();
    $("patients-message").textContent = patientDirectory.length ? "" : "No patients yet.";
  } catch (error) {
    $("patients-message").textContent = "Could not load patients. " + error.message;
  }
}

async function loadPatient(id) {
  const request = ++patientRequest;
  selectedPatientId = id;
  const patient = patientDirectory.find(item => String(item.id) === id);
  $("patient-selection").textContent = patient?.name || "Find a patient";
  $("patient-detail").replaceChildren();
  renderPatientMatches();
  if (!id) {
    if (patientDirectory.length) $("patients-message").textContent = "";
    return;
  }
  $("patients-message").textContent = "Loading history…";
  try {
    const { patient, reports } = await api("patients/" + id);
    if (request !== patientRequest) return;
    const records = node("ul");
    records.className = "history-list";
    for (const report of reports) {
      const row = node("li");
      const details = node("details");
      details.name = "patient-reports";
      const summary = node("summary");
      summary.append(node("b", report.report_date || "Report #" + report.id), node("span", statusLabel[report.status] || "Review status unavailable"));
      details.append(summary);
      const values = node("ul");
      for (const test of report.tests ?? []) values.append(node("li", reading(test)));
      if (!values.children.length) values.append(node("li", "No readable test values"));
      const layout = node("div");
      layout.className = "source-layout";
      layout.append(reportSource(report), values);
      details.append(layout);
      row.append(details);
      records.append(row);
    }
    $("patient-detail").append(node("h3", patient.name), reports.length ? records : node("p", "No reports for this patient yet."));
    $("patients-message").textContent = "";
  } catch (error) {
    if (request === patientRequest) $("patients-message").textContent = error.message;
  }
}

$("upload").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const file = $("report-file").files[0];
  if (!file) return;
  const result = $("upload-result");
  const message = $("upload-message");
  result.hidden = true;
  if (file.size > 10 * 1024 * 1024) {
    message.textContent = "Choose an image under 10 MB.";
    return;
  }
  const payload = new FormData(form);
  const submit = form.querySelector("button");
  submit.disabled = $("report-file").disabled = true;
  message.textContent = "Uploading and reading the screenshot…";
  try {
    const report = await api("reports", { method: "POST", body: payload });
    uploadedSources.set(report.id, URL.createObjectURL(file));
    result.textContent = [priorityLabel[report.level], statusLabel[report.status], reading(report.worst)]
      .filter(Boolean).join(" · ");
    const reviewLink = node("a", "Review uploaded report ↗");
    reviewLink.className = "action";
    reviewLink.href = "/nabz/clinic.html?view=review&report=" + encodeURIComponent(report.id);
    result.append(node("br"),reviewLink);
    result.hidden = false;
    message.textContent = "Report #" + report.id + " received.";
    form.reset();
    await Promise.all([loadInbox(), loadPatients(), loadPatient(selectedPatientId)]);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = $("report-file").disabled = false;
  }
});

let proofRows = [];
let proofFilter = "all";

function position(label, value) {
  const item = node("div");
  item.className = "comparison-position";
  item.append(node("span", label), node("strong", value == null ? "—" : "#" + value));
  return item;
}

function renderComparison() {
  const results = $("proof-result");
  const grid = node("div");
  grid.className = "comparison-grid";
  const rows = proofRows.filter(row => proofFilter === "all" || row.direction === proofFilter);
  for (const row of rows) {
    const card = node("article");
    card.className = "comparison-card";
    card.dataset.direction = row.direction;
    const heading = node("header");
    const identity = node("div");
    identity.append(node("h3", reportName(row.report)), node("small", "Report #" + row.report.id));
    const priority = node("span", priorityLabel[row.report.level] ?? "Unranked");
    priority.className = "priority";
    priority.dataset.level = row.report.level;
    heading.append(identity, priority);
    const flow = node("div");
    flow.className = "comparison-flow";
    const arrow = node("span", "→");
    arrow.setAttribute("aria-hidden", "true");
    flow.append(position("Arrival order", row.arrival), arrow, position("Nabz order", row.ranked));
    const movement = row.delta == null ? "Position unavailable" : row.delta === 0 ? "Same position"
      : "Moved " + row.direction + " " + Math.abs(row.delta) + (Math.abs(row.delta) === 1 ? " place" : " places");
    const footer = node("div");
    footer.className = "comparison-footer";
    const open = node("a", "Review ↗");
    open.href = "/nabz/clinic.html?view=review&report=" + encodeURIComponent(row.report.id);
    footer.append(node("span", movement), open);
    card.append(heading, flow, footer);
    grid.append(card);
  }
  results.replaceChildren(rows.length ? grid : node("p", "No reports in this view."));
}

function showComparison(arrival, ranked) {
  const initial = new Map(arrival.map((report, index) => [String(report.id), report.pos ?? index + 1]));
  proofRows = ranked.map((report, index) => {
    const before = initial.get(String(report.id));
    const after = report.pos ?? index + 1;
    const delta = before == null ? null : before - after;
    return {report, arrival: before, ranked: after, delta, direction: delta > 0 ? "up" : delta < 0 ? "down" : "same"};
  });
  $("proof-filter").hidden = !proofRows.length;
  renderComparison();
}

for (const button of document.querySelectorAll("[data-proof]")) {
  button.addEventListener("click", () => {
    proofFilter = button.dataset.proof;
    for (const item of document.querySelectorAll("[data-proof]")) {
      item.setAttribute("aria-pressed", String(item === button));
    }
    renderComparison();
  });
}

$("compare").addEventListener("click", async () => {
  const button = $("compare");
  const message = $("proof-message");
  button.disabled = true;
  message.textContent = "Loading comparison…";
  $("proof-result").replaceChildren();
  $("proof-filter").hidden = true;
  try {
    const data = await api("compare");
    const arrival = data.arrival_order ?? data.arrival;
    const ranked = data.nabz_order ?? data.ranked;
    if (!Array.isArray(arrival) || !Array.isArray(ranked)) throw new Error("Comparison response format is unavailable.");
    showComparison(arrival, ranked);
    if (ranked.length) {
      const urgentInFirstTen = reports => reports.slice(0, 10).filter(report => report.level === "urgent").length;
      message.textContent = "Urgent reports in the first 10 slots: " +
        urgentInFirstTen(arrival) + " in arrival order, " + urgentInFirstTen(ranked) + " in Nabz order.";
      button.textContent = "Refresh";
    } else {
      message.textContent = "No reports available to compare.";
    }
  } catch (error) {
    if (error.status === 404) {
      const reports = await api("inbox").catch(() => []);
      if (!reports.length) { message.textContent = "No reports available to compare."; return; }
      const byArrival = [...reports].sort((a, b) => String(a.received_at).localeCompare(String(b.received_at)));
      showComparison(byArrival, reports);
      message.textContent = "Computed from the current review queue.";
    } else {
      message.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
});

const workspaceViews = {
  overview: ["Clinic inbox", "See which reports need review and open the original case.", ["urgency", "review-queue"]],
  intake: ["Screenshot intake", "Upload a lab screenshot to add it to the review queue.", ["upload-panel"]],
  review: ["Review reports", "Compare each reading with its source before confirming.", ["review-queue"]],
  patients: ["Patient history", "Open a patient record to see prior reports and test values.", ["patient-history"]],
  comparison: ["Queue comparison", "See where urgent reports land in arrival order and in Nabz order.", ["comparison"]]
};

async function openWorkspace() {
  const query = new URLSearchParams(location.search);
  const linkedView = { "#upload-panel": "intake", "#patient-history": "patients", "#comparison": "comparison" };
  const view = query.get("view") || linkedView[location.hash] || "overview";
  activeWorkspace = Object.hasOwn(workspaceViews, view) ? view : "overview";
  openedReport = "";
  queuePage = 0;
  const [title, description, visible] = workspaceViews[activeWorkspace];
  document.body.dataset.workspace = activeWorkspace;
  document.title = "Nabz · " + title;
  $("workspace-title").textContent = title;
  $("workspace-description").textContent = description;
  $("clinic-visual").hidden = activeWorkspace !== "overview";
  for (const id of ["urgency", "review-queue", "upload-panel", "patient-history", "comparison"]) {
    $(id).hidden = !visible.includes(id);
  }
  for (const link of document.querySelectorAll("[data-workspace]")) {
    if (link.dataset.workspace === activeWorkspace) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  $("pending-only").checked = query.get("review") === "pending";
  if (activeWorkspace === "overview" || activeWorkspace === "review") {
    await loadInbox();
    if (location.hash === "#urgency") $("urgency").scrollIntoView();
  }
  if (activeWorkspace === "patients") {
    await loadPatients();
    if (activeWorkspace !== "patients") return;
    const requested = query.get("patient") || selectedPatientId;
    if (patientDirectory.some(patient => String(patient.id) === requested)) loadPatient(requested);
  }
  if (activeWorkspace === "comparison") $("compare").click();
}

document.addEventListener("click", event => {
  const link = event.target.closest("a[href]");
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const target = new URL(link.href);
  if (target.origin !== location.origin || target.pathname !== location.pathname) return;
  event.preventDefault();
  history.pushState({}, "", target);
  window.scrollTo(0, 0);
  openWorkspace();
});
window.addEventListener("popstate", openWorkspace);
$("patient-search").addEventListener("input", renderPatientMatches);
$("patient-picker").addEventListener("toggle", () => {
  if ($("patient-picker").open) $("patient-search").focus();
});
$("patient-picker").addEventListener("keydown", event => {
  if (event.key === "Escape" && $("patient-picker").open) {
    $("patient-picker").open = false;
    $("patient-picker").querySelector("summary").focus();
  }
});
$("refresh").addEventListener("click", loadInbox);
$("heat-refresh").addEventListener("click", loadInbox);
$("pending-only").addEventListener("change", () => { queuePage = 0; renderInbox(); });
$("queue-prev").addEventListener("click", () => { queuePage--; renderInbox(); });
$("queue-next").addEventListener("click", () => { queuePage++; renderInbox(); });
api("health")
  .then(data => { $("server").textContent = data.ok ? "Clinic connected" : "Connection unavailable"; })
  .catch(() => { $("server").textContent = "Clinic disconnected"; });
openWorkspace();
