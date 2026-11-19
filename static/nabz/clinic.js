const $ = (id) => document.getElementById(id);
const statusLabel = {
  ok: "Ready for review", pending: "Ready for review", needs_review: "Needs review",
  needs_verification: "Needs verification", confirmed: "Confirmed"
};
const priorityLabel = { urgent: "Urgent", unread: "Unread", watch: "Watch", routine: "Routine" };
const uploadedSources = new Map();
let currentReports = [];
let patientRequest = 0;

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

function renderReport(report) {
  const row = $("report-template").content.firstElementChild.cloneNode(true);
  row.querySelector("h3").textContent = reportName(report);
  const priority = row.querySelector(".priority");
  priority.textContent = priorityLabel[report.level] ?? "Unranked";
  priority.dataset.level = report.level;
  const timestamp = new Date(report.received_at);
  const date = report.received_at && !Number.isNaN(timestamp.getTime()) ? timestamp.toLocaleString() : "";
  row.querySelector(".metadata").textContent = [report.source, statusLabel[report.status], date]
    .filter(Boolean).join(" · ");
  row.querySelector(".finding").textContent = reading(report.worst);
  const source = uploadedSources.get(report.id);
  const image = row.querySelector("img");
  const note = row.querySelector(".source-note");
  note.textContent = source ? "Original uploaded in this session." : "Open the original screenshot from the intake channel before confirming.";
  if (source) {
    image.src = source;
    image.hidden = false;
  }
  const review = row.querySelector("input");
  const confirm = row.querySelector(".confirm");
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
      await Promise.all([loadInbox(), loadPatient($("patients").value)]);
    } catch (error) {
      message.textContent = error.message;
      confirm.disabled = review.disabled = false;
    }
  });
  if (report.caption) row.insertBefore(node("p", report.caption), row.querySelector("details"));
  return row;
}

async function loadInbox() {
  $("refresh").disabled = true;
  $("queue-message").textContent = "Loading reports…";
  try {
    currentReports = await api("inbox");
    $("queue").replaceChildren(...currentReports.map(renderReport));
    $("queue-message").textContent = currentReports.length ? currentReports.length + " report(s) · Highest priority first" : "No reports yet.";
  } catch (error) {
    $("queue-message").textContent = "Could not load the queue. " + error.message;
  } finally {
    $("refresh").disabled = false;
  }
}

async function loadPatients() {
  const select = $("patients");
  const previous = select.value;
  try {
    const patients = await api("patients");
    select.replaceChildren(new Option("Select a patient", ""));
    for (const patient of patients) {
      select.add(new Option(patient.name, patient.id));
    }
    if ([...select.options].some(option => option.value === previous)) select.value = previous;
    select.disabled = !patients.length;
    $("patients-message").textContent = patients.length ? "" : "No patients yet.";
  } catch (error) {
    $("patients-message").textContent = "Could not load patients. " + error.message;
  }
}

async function loadPatient(id) {
  const request = ++patientRequest;
  $("patient-detail").replaceChildren();
  if (!id) {
    if (!$("patients").disabled) $("patients-message").textContent = "";
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
      row.append(node("strong", [report.report_date, statusLabel[report.status]].filter(Boolean).join(" · ")));
      const values = node("ul");
      for (const test of report.tests ?? []) values.append(node("li", reading(test)));
      if (!values.children.length) values.append(node("li", "No readable test values"));
      row.append(values);
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
    result.hidden = false;
    message.textContent = "Report #" + report.id + " received.";
    form.reset();
    await Promise.all([loadInbox(), loadPatients(), loadPatient($("patients").value)]);
  } catch (error) {
    message.textContent = error.message;
  } finally {
    submit.disabled = $("report-file").disabled = false;
  }
});

function showComparison(arrival, ranked) {
  const columns = node("div");
  columns.className = "proof-columns";
  for (const [title, reports] of [["Arrival order", arrival], ["Nabz order", ranked]]) {
    const column = node("div");
    const entries = node("ol");
    for (const report of reports) {
      entries.append(node("li", reportName(report) + " · " + (priorityLabel[report.level] ?? "Unranked")));
    }
    column.append(node("h3", title), entries);
    columns.append(column);
  }
  $("proof-result").replaceChildren(columns);
}

$("compare").addEventListener("click", async () => {
  const button = $("compare");
  const message = $("proof-message");
  button.disabled = true;
  message.textContent = "Loading comparison…";
  $("proof-result").replaceChildren();
  try {
    const data = await api("compare");
    const arrival = data.arrival_order ?? data.arrival;
    const ranked = data.nabz_order ?? data.ranked;
    if (!Array.isArray(arrival) || !Array.isArray(ranked)) throw new Error("Comparison response format is unavailable.");
    showComparison(arrival, ranked);
    message.textContent = "Comparison from Flask.";
  } catch (error) {
    if (error.status === 404) {
      const routine = { id: 1, patient_name: "Sample report A", level: "routine" };
      const urgent = { id: 2, patient_name: "Sample report B", level: "urgent" };
      showComparison([routine, urgent], [urgent, routine]);
      message.textContent = "Synthetic example · Comparison endpoint pending.";
    } else {
      message.textContent = error.message;
    }
  } finally {
    button.disabled = false;
  }
});

$("patients").addEventListener("change", () => loadPatient($("patients").value));
$("refresh").addEventListener("click", () => Promise.all([loadInbox(), loadPatients()]));
api("health")
  .then(data => { $("server").textContent = data.ok ? "Connected to Flask" : "Flask status unavailable"; })
  .catch(() => { $("server").textContent = "Could not reach Flask"; });
loadInbox();
loadPatients();
