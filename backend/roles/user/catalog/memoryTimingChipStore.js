const { randomBytes } = require("crypto");

const TIMING_CHIP_SEED = [
  { value: "asap", label: "ASAP", sortOrder: 1 },
  { value: "this_week", label: "This Week", sortOrder: 2 },
  { value: "this_month", label: "This Month", sortOrder: 3 },
  { value: "flexible", label: "Flexible", sortOrder: 4 },
];

let chipsById = new Map();
let chipIdByValue = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createId() {
  return randomBytes(12).toString("hex");
}

function seed() {
  chipsById = new Map();
  chipIdByValue = new Map();
  for (const row of TIMING_CHIP_SEED) {
    const chip = {
      _id: createId(),
      value: row.value,
      label: row.label,
      active: true,
      sortOrder: row.sortOrder,
    };
    chipsById.set(chip._id, chip);
    chipIdByValue.set(chip.value, chip._id);
  }
}

function listAll() {
  return Array.from(chipsById.values())
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map(clone);
}

function listActive() {
  return listAll().filter((chip) => chip.active);
}

function findById(id) {
  const chip = chipsById.get(String(id));
  return chip ? clone(chip) : null;
}

function findByValue(value) {
  const id = chipIdByValue.get(
    String(value || "")
      .toLowerCase()
      .trim(),
  );
  return id ? findById(id) : null;
}

function create(data) {
  const chip = {
    _id: createId(),
    value: String(data.value).toLowerCase().trim(),
    label: String(data.label).trim(),
    active: data.active !== undefined ? Boolean(data.active) : true,
    sortOrder: data.sortOrder !== undefined ? Number(data.sortOrder) : 0,
  };
  chipsById.set(chip._id, chip);
  chipIdByValue.set(chip.value, chip._id);
  return clone(chip);
}

function update(id, patch) {
  const existing = chipsById.get(String(id));
  if (!existing) return null;
  const updated = { ...existing, ...patch, _id: existing._id };
  if (patch.value && patch.value !== existing.value) {
    chipIdByValue.delete(existing.value);
    updated.value = String(patch.value).toLowerCase().trim();
    chipIdByValue.set(updated.value, updated._id);
  }
  chipsById.set(updated._id, updated);
  return clone(updated);
}

function reset() {
  seed();
}

seed();

module.exports = { listAll, listActive, findById, findByValue, create, update, reset, TIMING_CHIP_SEED };
