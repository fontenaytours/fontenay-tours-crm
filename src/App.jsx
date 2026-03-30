import { useState, useEffect, useCallback } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer, Legend } from "recharts";
import { getRegistros, insertRegistro, updateRegistro, deleteRegistro } from "./supabase";

const PROMOTORES = ["Martín", "Jimmy", "Alexandra", "Brian", "Marcelo"];
const VENDEDORES = ["Nury", "Jimmy", "Marcelo", "Brian", "Alexandra", "Sebastián"];
const SUCURSALES = ["Fontenay BSAS", "Fontenay Florida", "Fontenay Plaza"];
const INTERESES = [
  "🚌 Buenos Aires Bus","💃 Tango & Cenas Show","🌊 Cataratas & Glaciares",
  "🏙️ City Tour","🚤 Delta & Tigre","🥩 Estancias & Campo",
  "🍷 Vinos & Bodegas","🇺🇾 Uruguay & Colonia","🌍 Excursiones regionales","🦁 Temaikén & Naturaleza",
];
const COLORS = ["#6366f1","#0ea5e9","#22c55e","#f59e0b","#ef4444","#8b5cf6","#14b8a6","#f97316","#ec4899","#84cc16"];
const SUC_COLORS = { "Fontenay BSAS": "#6366f1", "Fontenay Florida": "#0ea5e9", "Fontenay Plaza": "#22c55e" };
const F_ORANGE = "#FF5320", F_BLUE = "#17244E", F_WHITE = "#FFFFFF";
const EDIT_WINDOW_MS = 2 * 60 * 60 * 1000;

function getTodayStr() { return new Date().toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric" }); }
function getTimeStr() { return new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }); }
function fmtARS(n) { return "$ " + (n || 0).toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function isEditable(r) { return Date.now() - (r.timestamp || 0) < EDIT_WINDOW_MS; }
function minutosRestantes(r) { return Math.max(0, Math.ceil((EDIT_WINDOW_MS - (Date.now() - (r.timestamp || 0))) / 60000)); }

function getWeekRange(date) {
  const d = new Date(date), day = d.getDay();
  const sat = new Date(d); sat.setDate(d.getDate() + (day >= 6 ? 0 : -(day + 1))); sat.setHours(0, 0, 0, 0);
  const fri = new Date(sat); fri.setDate(sat.getDate() + 6); fri.setHours(23, 59, 59, 999);
  return { sat, fri };
}

function getPrevWeekRange() {
  const { sat } = getWeekRange(new Date());
  const dayBefore = new Date(sat.getTime() - 24 * 60 * 60 * 1000);
  return getWeekRange(dayBefore);
}

function fmtDate(d) { return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" }); }

function filterByWeekRange(registros, { sat, fri }) {
  return registros.filter(r => {
    const ts = r.timestamp || 0;
    return ts >= sat.getTime() && ts <= fri.getTime();
  });
}

function getWeekKey(timestamp) {
  const { sat } = getWeekRange(new Date(timestamp));
  return sat.getTime();
}

function groupByWeek(registros) {
  const byWeek = {};
  registros.forEach(r => {
    const ts = r.timestamp || 0;
    if (!ts) return;
    const key = getWeekKey(ts);
    if (!byWeek[key]) byWeek[key] = [];
    byWeek[key].push(r);
  });
  return byWeek;
}

function exportCSV(registros) {
  const { sat, fri } = getWeekRange(new Date());
  const headers = ["Fecha","Hora","Promotor","Sucursal","Vendedor","Contacto","WhatsApp","Grupo","Intereses","Ingresó","Vendido","Retorno","Monto ARS"];
  const rows = registros.map(r => [
    r.fecha, r.hora, r.promotor, r.sucursal, r.vendedor, r.pasajero, r.whatsapp || "",
    r.grupoSize, (r.intereses || []).join(" | "),
    r.ingreso ? "Sí" : "No",
    r.vendido === true ? "Sí" : r.vendido === false ? "No" : "Pendiente",
    r.retorno ? "Sí" : "No", r.monto || 0
  ]);
  const totalMonto = registros.reduce((a, r) => a + (r.monto || 0), 0);
  const totalVendidos = registros.filter(r => r.vendido).reduce((a, r) => a + r.grupoSize, 0);
  const totalPersonas = registros.reduce((a, r) => a + r.grupoSize, 0);
  rows.push([], [" RESUMEN"]);
  rows.push(["Semana", fmtDate(sat) + " al " + fmtDate(fri)]);
  rows.push(["Personas contactadas", totalPersonas]);
  rows.push(["Vendidos", totalVendidos]);
  rows.push(["Facturado ARS", totalMonto]);
  rows.push(["Conversión", totalPersonas > 0 ? ((totalVendidos / totalPersonas) * 100).toFixed(1) + "%" : "—"]);
  const csv = [headers, ...rows].map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url;
  a.download = "semana_" + fmtDate(sat).replace(/\//g, "-") + ".csv";
  a.click(); URL.revokeObjectURL(url);
}

function calcMetrics(registros) {
  const byPromotor = {}, byVendedor = {}, bySucursal = {};
  registros.forEach(r => {
    if (!byPromotor[r.promotor]) byPromotor[r.promotor] = { contactos: 0, personas: 0, ingresaron: 0, vendidos: 0, monto: 0 };
    byPromotor[r.promotor].contactos += 1;
    byPromotor[r.promotor].personas += (r.grupoSize || 1);
    if (r.ingreso) byPromotor[r.promotor].ingresaron += (r.grupoSize || 1);
    if (r.vendido) {
      byPromotor[r.promotor].vendidos += (r.grupoSize || 1);
      byPromotor[r.promotor].monto += (r.monto || 0);
      const v = r.vendedor || "Sin asignar";
      if (!byVendedor[v]) byVendedor[v] = { ventas: 0, clientes: 0, monto: 0 };
      byVendedor[v].ventas += 1; byVendedor[v].clientes += (r.grupoSize || 1); byVendedor[v].monto += (r.monto || 0);
      const suc = r.sucursal || "Sin sucursal";
      if (!bySucursal[suc]) bySucursal[suc] = { ventas: 0, clientes: 0, monto: 0 };
      bySucursal[suc].ventas += 1; bySucursal[suc].clientes += (r.grupoSize || 1); bySucursal[suc].monto += (r.monto || 0);
    }
  });
  return { byPromotor, byVendedor, bySucursal };
}

function calcPuntos(d) {
  return (d.contactos || 0) * 2 + (d.ingresaron || 0) * 3 + (d.vendidos || 0) * 5;
}

function getWinnersForWeek(registros) {
  const m = calcMetrics(registros);
  const promotorWinner = Object.entries(m.byPromotor).sort((a, b) => calcPuntos(b[1]) - calcPuntos(a[1]))[0];
  const vendedorWinner = Object.entries(m.byVendedor).sort((a, b) => b[1].monto - a[1].monto)[0];
  return { promotorWinner, vendedorWinner, metrics: m };
}

function MiniPie({ value, max, color, label, sub }) {
  const pct = Math.min(value / (max || 1), 1), r = 30, cx = 34, cy = 34, circ = 2 * Math.PI * r;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <svg width="68" height="68">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
        <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="8"
          strokeDasharray={(pct * circ) + " " + circ} strokeDashoffset={circ / 4}
          strokeLinecap="round" style={{ transition: "stroke-dasharray 0.8s ease" }} />
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#1e293b">{Math.round(pct * 100)}%</text>
      </svg>
      <p style={{ fontSize: 11, fontWeight: 700, color: "#1e293b", margin: "3px 0 1px", textAlign: "center" }}>{label}</p>
      <p style={{ fontSize: 10, color: "#94a3b8", margin: 0, textAlign: "center" }}>{sub}</p>
    </div>
  );
}

function StatusBadge({ r }) {
  if (r.vendido && r.retorno) return <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "#dcfce7", color: "#166534" }}>🔄💰 Retorno vendido</span>;
  if (r.vendido) return <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "#dcfce7", color: "#166534" }}>💰 Vendido</span>;
  if (r.retorno && r.ingreso) return <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "#ede9fe", color: "#6366f1" }}>🔄 Retorno en oficina</span>;
  if (r.ingreso) return <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "#dbeafe", color: "#1d4ed8" }}>🏢 En oficina</span>;
  return <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700, background: "#f1f5f9", color: "#64748b" }}>🗣 Contacto</span>;
}

function WeekCard({ weekSat, weekFri, registros, isOpen, onToggle, weekNum }) {
  const { promotorWinner, vendedorWinner, metrics } = getWinnersForWeek(registros);
  const totalPersonas = registros.reduce((a, r) => a + (r.grupoSize || 1), 0);
  const totalVendidos = registros.filter(r => r.vendido).reduce((a, r) => a + (r.grupoSize || 1), 0);
  const totalMonto = registros.reduce((a, r) => a + (r.monto || 0), 0);
  const convRate = totalPersonas > 0 ? ((totalVendidos / totalPersonas) * 100).toFixed(1) : 0;

  const nivelPromotor = (p) => {
    const d = metrics.byPromotor[p] || {};
    const pts = calcPuntos(d);
    if (pts >= 300) return { nivel: "🥇 Oro", color: "#f59e0b" };
    if (pts >= 150) return { nivel: "🥈 Plata", color: "#94a3b8" };
    return { nivel: "🥉 Bronce", color: "#cd7f32" };
  };

  return (
    <div style={{ background: "white", borderRadius: 16, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: 12, overflow: "hidden", border: "1px solid #f1f5f9" }}>
      <button onClick={onToggle} style={{ width: "100%", padding: "14px 20px", background: "none", border: "none", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "left" }}>
          <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: F_BLUE }}>
            {weekNum ? `Semana ${weekNum}: ` : ""}{fmtDate(weekSat)} → {fmtDate(weekFri)}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 11, color: "#64748b" }}>
            {registros.length} registros · {totalPersonas} personas · {hideMoney(totalMonto)}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {promotorWinner && (
            <span style={{ background: "#fef3c7", color: "#92400e", padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
              🏃 {promotorWinner[0]}
            </span>
          )}
          {vendedorWinner && (
            <span style={{ background: "#dcfce7", color: "#166534", padding: "3px 10px", borderRadius: 8, fontSize: 11, fontWeight: 700 }}>
              💼 {vendedorWinner[0]}
            </span>
          )}
          <span style={{ fontSize: 16, color: "#94a3b8", fontWeight: 700 }}>{isOpen ? "▲" : "▼"}</span>
        </div>
      </button>

      {isOpen && (
        <div style={{ padding: "0 20px 20px", borderTop: "1px solid #f1f5f9" }}>
          {/* Ganadores */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, margin: "16px 0" }}>
            <div style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)", borderRadius: 12, padding: "14px", color: "white" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, opacity: 0.85 }}>🏆 MEJOR PROMOTOR</p>
              {promotorWinner ? (
                <>
                  <p style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 800 }}>{promotorWinner[0]}</p>
                  <p style={{ margin: 0, fontSize: 11, opacity: 0.9 }}>
                    {calcPuntos(promotorWinner[1])} pts · {promotorWinner[1].personas} contactos
                  </p>
                </>
              ) : <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>Sin datos</p>}
            </div>
            <div style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", borderRadius: 12, padding: "14px", color: "white" }}>
              <p style={{ margin: "0 0 4px", fontSize: 10, fontWeight: 700, opacity: 0.85 }}>🏆 MEJOR VENDEDOR</p>
              {vendedorWinner ? (
                <>
                  <p style={{ margin: "0 0 2px", fontSize: 16, fontWeight: 800 }}>{vendedorWinner[0]}</p>
                  <p style={{ margin: 0, fontSize: 11, opacity: 0.9 }}>
                    {vendedorWinner[1].ventas} ventas · {hideMoney(vendedorWinner[1].monto)}
                  </p>
                </>
              ) : <p style={{ margin: 0, fontSize: 13, opacity: 0.8 }}>Sin ventas</p>}
            </div>
          </div>

          {/* Stats resumen */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 8, marginBottom: 16 }}>
            {[["👥", "Contactos", totalPersonas], ["🏢", "Ingresos", registros.filter(r => r.ingreso).reduce((a,r) => a+(r.grupoSize||1), 0)], ["💰", "Vendidos", totalVendidos], ["🎯", "Conv.", convRate + "%"]].map(([ico, label, val]) => (
              <div key={label} style={{ background: "#f8fafc", borderRadius: 10, padding: "10px 8px", textAlign: "center" }}>
                <p style={{ margin: 0, fontSize: 16 }}>{ico}</p>
                <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 800, color: "#1e293b" }}>{val}</p>
                <p style={{ margin: 0, fontSize: 9, color: "#94a3b8", fontWeight: 600 }}>{label}</p>
              </div>
            ))}
          </div>

          {/* Ranking promotores */}
          {Object.keys(metrics.byPromotor).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: "#1e293b" }}>🏃 Ranking Promotores</p>
              {Object.entries(metrics.byPromotor).sort((a, b) => calcPuntos(b[1]) - calcPuntos(a[1])).map(([n, d], i) => {
                const nv = nivelPromotor(n);
                const pts = calcPuntos(d);
                return (
                  <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "8px 10px", borderRadius: 10, background: i === 0 ? "#fef9c3" : "#f8fafc" }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#94a3b8", width: 18 }}>{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{n}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>{d.personas} cont · {d.ingresaron} ing · {d.vendidos} ventas</p>
                    </div>
                    <span style={{ background: nv.color + "22", color: nv.color, padding: "3px 8px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{pts} pts</span>
                    {i === 0 && <span style={{ fontSize: 14 }}>🥇</span>}
                  </div>
                );
              })}
            </div>
          )}

          {/* Ranking vendedores */}
          {Object.keys(metrics.byVendedor).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: "#1e293b" }}>💼 Ranking Vendedores</p>
              {Object.entries(metrics.byVendedor).sort((a, b) => b[1].monto - a[1].monto).map(([n, d], i) => (
                <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, padding: "8px 10px", borderRadius: 10, background: i === 0 ? "#f0fdf4" : "#f8fafc" }}>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#94a3b8", width: 18 }}>{i + 1}</span>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{n}</p>
                    <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>{d.ventas} ventas · {d.clientes} clientes</p>
                  </div>
                  <span style={{ fontWeight: 700, fontSize: 13, color: "#22c55e" }}>{hideMoney(d.monto)}</span>
                  {i === 0 && <span style={{ fontSize: 14 }}>🥇</span>}
                </div>
              ))}
            </div>
          )}

          {/* Intereses de la semana */}
          {(() => {
            const interesesCount = {};
            registros.forEach(r => (r.intereses || []).forEach(i => { interesesCount[i] = (interesesCount[i] || 0) + 1; }));
            const sorted = Object.entries(interesesCount).sort((a, b) => b[1] - a[1]);
            if (sorted.length === 0) return null;
            return (
              <div>
                <p style={{ margin: "0 0 8px", fontWeight: 700, fontSize: 13, color: "#1e293b" }}>🎯 Intereses de la semana</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {sorted.map(([interes, count]) => (
                    <div key={interes} style={{ background: "#f1f5f9", borderRadius: 20, padding: "5px 12px", display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontSize: 12, color: "#1e293b" }}>{interes}</span>
                      <span style={{ background: "#6366f1", color: "white", borderRadius: 10, padding: "1px 7px", fontSize: 11, fontWeight: 700 }}>{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

const FORM_STEPS = ["inicio", "promotor", "sucursal", "vendedor", "pasajero", "grupo", "intereses", "fase"];

export default function App() {
  const [view, setView] = useState("form");
  const [privacyMode, setPrivacyMode] = useState(false);
  const hideMoney = (val) => privacyMode ? "$ ●●●●●" : (typeof val === "string" ? val : fmtARS(val));
  const hideNum = (val) => privacyMode ? "●●●" : val;
  const [step, setStep] = useState(0);
  const [registros, setRegistros] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ promotor: "", sucursal: "", vendedor: "", pasajero: "", whatsapp: "", grupoSize: 1, intereses: [], monto: "" });
  const [updateModal, setUpdateModal] = useState(null);
  const [updateData, setUpdateData] = useState({ vendido: null, monto: "" });
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState(null);
  const [dashTab, setDashTab] = useState("operativo");
  const [openWeeks, setOpenWeeks] = useState({});

  const cargar = useCallback(async () => {
    try {
      const data = await getRegistros();
      setRegistros(data);
      setError(null);
    } catch (e) {
      setError("Error conectando con la base de datos: " + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const iv = setInterval(cargar, 20000);
    return () => clearInterval(iv);
  }, [cargar]);

  // ── Semana actual y anterior ──────────────────────────────────────────────
  const weekRange = getWeekRange(new Date());
  const prevWeekRange = getPrevWeekRange();
  const currentWeekRegistros = filterByWeekRange(registros, weekRange);
  const prevWeekRegistros = filterByWeekRange(registros, prevWeekRange);
  const prevWinners = getWinnersForWeek(prevWeekRegistros);

  const submitForm = async (fase) => {
    setSaving(true);
    const reg = {
      promotor: form.promotor, sucursal: form.sucursal, vendedor: form.vendedor,
      pasajero: form.pasajero, whatsapp: form.whatsapp || null,
      grupoSize: form.grupoSize, intereses: form.intereses,
      ingreso: fase !== "calle",
      vendido: fase === "vendido" ? true : fase === "ingreso" ? null : false,
      retorno: false,
      monto: fase === "vendido" ? (parseFloat(form.monto) || 0) : 0,
      hora: getTimeStr(), fecha: new Date().toLocaleDateString("es-AR"),
      timestamp: Date.now()
    };
    try {
      await insertRegistro(reg);
      await cargar();
      setForm({ promotor: "", sucursal: "", vendedor: "", pasajero: "", whatsapp: "", grupoSize: 1, intereses: [], monto: "" });
      setStep(0); setView("lista");
    } catch (e) {
      setError("Error guardando: " + e.message);
    } finally {
      setSaving(false);
    }
  };

  const confirmUpdate = async () => {
    if (!updateModal) return;
    try {
      await updateRegistro(updateModal.id, { vendido: updateData.vendido, monto: updateData.vendido ? (parseFloat(updateData.monto) || 0) : 0 });
      await cargar(); setUpdateModal(null);
    } catch (e) { setError("Error actualizando: " + e.message); }
  };

  const saveEdit = async () => {
    if (!editModal) return;
    const { id, created_at, ...data } = editForm;
    try {
      await updateRegistro(id, data);
      await cargar(); setEditModal(null); setEditForm(null);
    } catch (e) { setError("Error editando: " + e.message); }
  };

  const borrar = async (id) => {
    if (!window.confirm("¿Seguro que querés borrar este registro?")) return;
    try { await deleteRegistro(id); await cargar(); }
    catch (e) { setError("Error borrando: " + e.message); }
  };

  const marcarRetorno = async (r) => {
    try { await updateRegistro(r.id, { ingreso: true, retorno: true, vendido: null }); await cargar(); }
    catch (e) { setError(e.message); }
  };

  // Métricas SOLO semana actual
  const metrics = calcMetrics(currentWeekRegistros);
  const totalPersonas = currentWeekRegistros.reduce((a, r) => a + (r.grupoSize || 1), 0);
  const totalIngresaron = currentWeekRegistros.filter(r => r.ingreso).reduce((a, r) => a + (r.grupoSize || 1), 0);
  const totalVendidos = currentWeekRegistros.filter(r => r.vendido).reduce((a, r) => a + (r.grupoSize || 1), 0);
  const totalMonto = currentWeekRegistros.reduce((a, r) => a + (r.monto || 0), 0);
  const enOficina = currentWeekRegistros.filter(r => r.ingreso && r.vendido === null);
  const convRate = totalPersonas > 0 ? ((totalVendidos / totalPersonas) * 100).toFixed(1) : 0;
  const avgTicket = totalVendidos > 0 ? (totalMonto / totalVendidos).toFixed(0) : 0;

  const promotorBarData = Object.entries(metrics.byPromotor).map(([n, d]) => ({ name: n, Contactos: d.personas, Ingresos: d.ingresaron, Vendidos: d.vendidos }));
  const sucursalPieData = Object.entries(metrics.bySucursal).map(([n, d]) => ({ name: n, value: d.ventas, monto: d.monto }));
  const interesesData = INTERESES.map(i => ({ name: i, value: currentWeekRegistros.filter(r => (r.intereses || []).includes(i)).length })).filter(x => x.value > 0);

  const nivelPromotor = (p) => {
    const d = metrics.byPromotor[p] || {};
    const pts = calcPuntos(d);
    if (pts >= 300) return { nivel: "🥇 Oro", color: "#f59e0b" };
    if (pts >= 150) return { nivel: "🥈 Plata", color: "#94a3b8" };
    return { nivel: "🥉 Bronce", color: "#cd7f32" };
  };

  // Historial: agrupar por semana excluyendo semana actual
  const byWeek = groupByWeek(registros);
  const currentWeekKey = weekRange.sat.getTime();
  const historialWeeks = Object.entries(byWeek)
    .filter(([key]) => Number(key) !== currentWeekKey)
    .sort((a, b) => Number(b[0]) - Number(a[0]));

  // Consistencia: solo últimas 4 semanas anteriores (bonus mensual)
  function calcConsistencia() {
    const promotorWins = {}, vendedorWins = {};
    const last4 = historialWeeks.slice(0, 4);
    last4.forEach(([, regs]) => {
      const { promotorWinner, vendedorWinner } = getWinnersForWeek(regs);
      if (promotorWinner) promotorWins[promotorWinner[0]] = (promotorWins[promotorWinner[0]] || 0) + 1;
      if (vendedorWinner) vendedorWins[vendedorWinner[0]] = (vendedorWins[vendedorWinner[0]] || 0) + 1;
    });
    return { promotorWins, vendedorWins, semanas: last4.length };
  }
  const consistencia = calcConsistencia();

  const s = FORM_STEPS[step];
  const card = { background: "white", borderRadius: 20, padding: "28px 24px", boxShadow: "0 4px 24px rgba(0,0,0,0.08)", maxWidth: 480, width: "100%" };
  const btnP = { background: F_ORANGE, color: F_WHITE, border: "none", borderRadius: 12, padding: "13px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%", marginTop: 10, boxShadow: "0 4px 12px rgba(255,83,32,0.3)" };
  const btnS = { background: "#f8fafc", color: F_BLUE, border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8, width: "100%" };
  const inp = { width: "100%", padding: "11px 14px", borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 14, outline: "none", boxSizing: "border-box", marginTop: 6, fontFamily: "inherit" };

  const Pill = ({ label, selected, onClick }) => (
    <button onClick={onClick} style={{ padding: "8px 14px", borderRadius: 50, border: "2px solid " + (selected ? F_ORANGE : "#e2e8f0"), background: selected ? F_ORANGE : "white", color: selected ? F_WHITE : "#64748b", fontWeight: 600, fontSize: 13, cursor: "pointer", margin: "3px", transition: "all 0.2s" }}>{label}</button>
  );
  const SucPill = ({ suc }) => {
    const c = SUC_COLORS[suc] || F_ORANGE, sel = form.sucursal === suc;
    return <button onClick={() => setForm(f => ({ ...f, sucursal: suc }))} style={{ width: "100%", textAlign: "left", padding: "14px 18px", borderRadius: 14, border: "2px solid " + (sel ? c : "#e2e8f0"), background: sel ? c + "18" : "white", cursor: "pointer", marginBottom: 8 }}>
      <p style={{ margin: 0, fontWeight: 700, fontSize: 14, color: sel ? c : F_BLUE }}>📍 {suc}</p>
    </button>;
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#f8fafc 0%,#e8edf5 100%)", fontFamily: "'Inter','Segoe UI',sans-serif" }}>
      {loading && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.95)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", zIndex: 200 }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⏳</div>
          <p style={{ fontWeight: 700, color: F_BLUE, fontSize: 16 }}>Cargando datos del equipo...</p>
        </div>
      )}

      {error && (
        <div style={{ position: "fixed", top: 60, left: 0, right: 0, zIndex: 99, padding: "10px 20px" }}>
          <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <p style={{ color: "#dc2626", fontSize: 13, fontWeight: 600, margin: 0 }}>{error}</p>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#dc2626", cursor: "pointer", fontSize: 18 }}>×</button>
          </div>
        </div>
      )}

      {/* Nav */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 20px", background: "#ffffff", boxShadow: "0 2px 12px rgba(0,0,0,0.08)", position: "sticky", top: 0, zIndex: 10, flexWrap: "wrap", gap: 8, borderBottom: "2px solid #f1f5f9" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <img src="/logo FONTENAY TOURS OK.png" alt="Fontenay Tours" style={{ height: 40, objectFit: "contain" }} />
          <span style={{ color: "#94a3b8", fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>CRM</span>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {[["form", "📋 Registrar"], ["dashboard", "📊 Dashboard"], ["lista", "👥 Registros"], ["reglas", "🏆 Premios"], ["historial", "📅 Historial"]].map(([v, l]) => (
            <button key={v} onClick={() => { setView(v); if (v === "form") setStep(0); }}
              style={{ padding: "7px 14px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: view === v ? F_ORANGE : "#f1f5f9", color: view === v ? F_WHITE : F_BLUE, transition: "all 0.2s" }}>{l}</button>
          ))}
          <button onClick={() => setPrivacyMode(p => !p)}
            title={privacyMode ? "Mostrar números" : "Ocultar números (modo privacidad)"}
            style={{ padding: "7px 12px", borderRadius: 8, border: "none", fontWeight: 700, fontSize: 13, cursor: "pointer",
              background: privacyMode ? "#fef3c7" : "#f1f5f9", color: privacyMode ? "#92400e" : "#64748b",
              transition: "all 0.2s", flexShrink: 0 }}>
            {privacyMode ? "🙈" : "👁"}
          </button>
          {enOficina.length > 0 && <div style={{ background: "#fef3c7", color: "#92400e", borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 700 }}>⏳ {enOficina.length} en oficina</div>}
        </div>
      </div>

      {/* PREMIOS */}
      {view === "reglas" && (
        <div style={{ maxWidth: 600, margin: "0 auto", padding: 20 }}>
          <div style={{ textAlign: "center", padding: "28px 0 20px" }}>
            <div style={{ fontSize: 48 }}>🏆</div>
            <h1 style={{ fontSize: 24, fontWeight: 800, color: "#1e293b", margin: "8px 0 4px" }}>¿Cómo funciona el concurso?</h1>
          </div>

          {/* ── GANADORES SEMANA ANTERIOR ── */}
          {prevWeekRegistros.length > 0 && (
            <div style={{ background: "linear-gradient(135deg,#1e293b,#334155)", borderRadius: 20, padding: 20, marginBottom: 20, color: "white" }}>
              <p style={{ margin: "0 0 12px", fontSize: 12, fontWeight: 700, opacity: 0.7, letterSpacing: 1 }}>🏅 GANADORES SEMANA ANTERIOR</p>
              <p style={{ margin: "0 0 14px", fontSize: 12, opacity: 0.6 }}>{fmtDate(prevWeekRange.sat)} → {fmtDate(prevWeekRange.fri)}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ background: "linear-gradient(135deg,rgba(245,158,11,0.3),rgba(249,115,22,0.3))", borderRadius: 14, padding: "16px", border: "1px solid rgba(245,158,11,0.4)" }}>
                  <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 700, opacity: 0.8 }}>🏃 MEJOR PROMOTOR</p>
                  {prevWinners.promotorWinner ? (
                    <>
                      <p style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800 }}>{prevWinners.promotorWinner[0]}</p>
                      <p style={{ margin: "0 0 2px", fontSize: 12, opacity: 0.9 }}>
                        {calcPuntos(prevWinners.promotorWinner[1])} puntos
                      </p>
                      <p style={{ margin: "0 0 8px", fontSize: 11, opacity: 0.7 }}>
                        {prevWinners.promotorWinner[1].personas} contactos · {prevWinners.promotorWinner[1].ingresaron} ingresos · {prevWinners.promotorWinner[1].vendidos} ventas
                      </p>
                      <div style={{ background: "rgba(245,158,11,0.4)", borderRadius: 8, padding: "8px 12px", display: "inline-block" }}>
                        <p style={{ margin: 0, fontWeight: 800, fontSize: 13 }}>💵 Premio: $20 USD</p>
                      </div>
                    </>
                  ) : <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>Sin datos</p>}
                </div>
                <div style={{ background: "linear-gradient(135deg,rgba(34,197,94,0.3),rgba(22,163,74,0.3))", borderRadius: 14, padding: "16px", border: "1px solid rgba(34,197,94,0.4)" }}>
                  <p style={{ margin: "0 0 6px", fontSize: 10, fontWeight: 700, opacity: 0.8 }}>💼 MEJOR VENDEDOR</p>
                  {prevWinners.vendedorWinner ? (
                    <>
                      <p style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 800 }}>{prevWinners.vendedorWinner[0]}</p>
                      <p style={{ margin: "0 0 2px", fontSize: 12, opacity: 0.9 }}>
                        {prevWinners.vendedorWinner[1].ventas} ventas
                      </p>
                      <p style={{ margin: "0 0 8px", fontSize: 11, opacity: 0.7 }}>
                        {hideMoney(prevWinners.vendedorWinner[1].monto)} facturado
                      </p>
                      <div style={{ background: "rgba(34,197,94,0.4)", borderRadius: 8, padding: "8px 12px", display: "inline-block" }}>
                        <p style={{ margin: 0, fontWeight: 800, fontSize: 13 }}>💵 Premio: $20 USD</p>
                      </div>
                    </>
                  ) : <p style={{ margin: 0, fontSize: 13, opacity: 0.7 }}>Sin ventas</p>}
                </div>
              </div>
            </div>
          )}

          <div style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 18, padding: 20, marginBottom: 14, color: "white" }}>
            <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, opacity: 0.8 }}>📅 CUÁNDO</p>
            <p style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800 }}>La semana arranca cada sábado</p>
            <p style={{ margin: 0, fontSize: 13, opacity: 0.85 }}>Empieza el sábado y termina el viernes.</p>
          </div>
          <div style={{ background: "linear-gradient(135deg,#f59e0b,#f97316)", borderRadius: 18, padding: 20, marginBottom: 14, color: "white" }}>
            <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 700, opacity: 0.8 }}>💰 CUÁNTO</p>
            <p style={{ margin: "0 0 10px", fontSize: 18, fontWeight: 800 }}>$200 USD por mes para repartir</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              {[["🏃 Promotores", "$100 USD", "$20/sem · $20 bonus"], ["💼 Vendedores", "$100 USD", "$20/sem · $20 bonus"]].map(([r, t, s]) => (
                <div key={r} style={{ background: "rgba(255,255,255,0.2)", borderRadius: 12, padding: "12px" }}>
                  <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 700 }}>{r}</p>
                  <p style={{ margin: "0 0 2px", fontSize: 20, fontWeight: 800 }}>{t}</p>
                  <p style={{ margin: 0, fontSize: 11, opacity: 0.85 }}>{s}</p>
                </div>
              ))}
            </div>
          </div>
          <div style={{ background: "white", borderRadius: 18, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: 14 }}>
            <p style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800, color: "#22c55e" }}>💼 Vendedores — cómo participan</p>
            {[["💰", "Más ventas, más peso", "Cada venta suma al ranking semanal"], ["📊", "El ranking lo define el monto", "Gana quien más $ ARS facturó en la semana"], ["🔄", "Retornos vendidos cuentan", "Una venta de retorno suma igual que una nueva"]].map(([ico, accion, desc]) => (
              <div key={accion} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 22, width: 32, textAlign: "center" }}>{ico}</span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{accion}</p>
                  <p style={{ margin: 0, fontSize: 11, color: "#94a3b8" }}>{desc}</p>
                </div>
              </div>
            ))}

          </div>
          <div style={{ background: "linear-gradient(135deg,#f0f9ff,#e0f2fe)", borderRadius: 18, padding: 18, marginBottom: 14, border: "1px solid #bae6fd", display: "flex", gap: 14, alignItems: "center" }}>
            <span style={{ fontSize: 32 }}>⏱️</span>
            <div>
              <p style={{ margin: "0 0 4px", fontWeight: 800, fontSize: 14, color: "#0369a1" }}>Regla de transparencia</p>
              <p style={{ margin: 0, fontSize: 12, color: "#0c4a6e", lineHeight: 1.5 }}>Los registros se pueden editar hasta <b>2 horas</b> después de cargados. Pasado ese tiempo quedan fijos para garantizar la integridad del concurso.</p>
            </div>
          </div>
          <div style={{ background: "white", borderRadius: 18, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.06)", marginBottom: 14 }}>
            <p style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 800, color: "#6366f1" }}>🏃 Promotores — sistema de puntos</p>
            {[["🗣", "Hablar con alguien", "2 pts por persona"], ["🏢", "Meterlos a la oficina", "3 pts por persona"], ["💰", "Que se venda", "5 pts por persona"], ["🔄", "Retorno que compra", "5 pts extra"]].map(([ico, accion, pts]) => (
              <div key={accion} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid #f1f5f9" }}>
                <span style={{ fontSize: 22, width: 32, textAlign: "center" }}>{ico}</span>
                <div style={{ flex: 1 }}><p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{accion}</p></div>
                <span style={{ background: "#ede9fe", color: "#6366f1", padding: "4px 10px", borderRadius: 8, fontSize: 12, fontWeight: 700 }}>{pts}</span>
              </div>
            ))}
          </div>
          <button onClick={() => { setView("form"); setStep(0); }} style={{ width: "100%", padding: "16px", borderRadius: 16, background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "white", border: "none", fontSize: 16, fontWeight: 800, cursor: "pointer", marginBottom: 20 }}>
            ¡Empezar a registrar! 🚀
          </button>
        </div>
      )}

      {/* HISTORIAL */}
      {view === "historial" && (
        <div style={{ maxWidth: 700, margin: "0 auto", padding: 20 }}>
          <div style={{ margin: "16px 0 20px" }}>
            <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", margin: "0 0 4px" }}>📅 Estado de Resultados</h2>
            <p style={{ color: "#64748b", fontSize: 12, margin: 0 }}>Historial semanal · {registros.length} registros totales</p>
          </div>

          {/* Bonus de consistencia */}
          {historialWeeks.length > 0 && (
            <div style={{ background: "linear-gradient(135deg,#6366f1,#8b5cf6)", borderRadius: 18, padding: 20, marginBottom: 20, color: "white" }}>
              <p style={{ margin: "0 0 4px", fontSize: 13, fontWeight: 800 }}>⭐ Bonus de Consistencia Mensual</p>
              <p style={{ margin: "0 0 6px", fontSize: 11, opacity: 0.8 }}>El $20 USD extra se entrega al final de cada ciclo de 4 semanas · al que más veces ganó en ese período</p>
              <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
                {[1,2,3,4].map(n => (
                  <div key={n} style={{ flex: 1, height: 6, borderRadius: 4, background: n <= consistencia.semanas ? "rgba(255,255,255,0.9)" : "rgba(255,255,255,0.25)" }} />
                ))}
              </div>
              <p style={{ margin: "0 0 14px", fontSize: 11, opacity: 0.7 }}>Semana {consistencia.semanas} de 4 — {4 - consistencia.semanas} semana{4 - consistencia.semanas !== 1 ? "s" : ""} restante{4 - consistencia.semanas !== 1 ? "s" : ""} para cerrar el ciclo</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, opacity: 0.8 }}>🏃 PROMOTORES</p>
                  {Object.keys(consistencia.promotorWins).length === 0
                    ? <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>Sin datos</p>
                    : Object.entries(consistencia.promotorWins).sort((a, b) => b[1] - a[1]).map(([name, wins]) => (
                      <div key={name} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{name}</span>
                        <span style={{ background: "rgba(255,255,255,0.25)", borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 800 }}>{wins} 🏆</span>
                      </div>
                    ))
                  }
                </div>
                <div>
                  <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, opacity: 0.8 }}>💼 VENDEDORES</p>
                  {Object.keys(consistencia.vendedorWins).length === 0
                    ? <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>Sin datos</p>
                    : Object.entries(consistencia.vendedorWins).sort((a, b) => b[1] - a[1]).map(([name, wins]) => (
                      <div key={name} style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{name}</span>
                        <span style={{ background: "rgba(255,255,255,0.25)", borderRadius: 6, padding: "2px 10px", fontSize: 12, fontWeight: 800 }}>{wins} 🏆</span>
                      </div>
                    ))
                  }
                </div>
              </div>
            </div>
          )}

          {/* Semanas */}
          {historialWeeks.length === 0 ? (
            <div style={{ textAlign: "center", padding: 40, color: "#94a3b8" }}>
              <div style={{ fontSize: 40 }}>📋</div>
              <p style={{ fontWeight: 600, marginTop: 10 }}>No hay semanas anteriores todavía</p>
              <p style={{ fontSize: 12 }}>Los datos de semanas pasadas aparecerán aquí</p>
            </div>
          ) : (
            historialWeeks.map(([key, regs], idx) => {
              const wSat = new Date(Number(key));
              const { fri: wFri } = getWeekRange(wSat);
              const isOpen = openWeeks[key] || false;
              return (
                <WeekCard
                  key={key}
                  weekSat={wSat}
                  weekFri={wFri}
                  registros={regs}
                  isOpen={isOpen}
                  weekNum={historialWeeks.length - idx}
                  onToggle={() => setOpenWeeks(prev => ({ ...prev, [key]: !prev[key] }))}
                />
              );
            })
          )}
        </div>
      )}

      {/* FORM */}
      {view === "form" && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", minHeight: "calc(100vh - 52px)", padding: 20, paddingTop: 30 }}>
          <div style={card}>
            <div style={{ display: "flex", gap: 3, marginBottom: 20 }}>
              {FORM_STEPS.map((_, i) => <div key={i} style={{ flex: 1, height: 3, borderRadius: 4, background: i <= step ? F_ORANGE : "#e2e8f0", transition: "background 0.3s" }} />)}
            </div>
            {s === "inicio" && <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>🌍</div>
              <h1 style={{ fontSize: 24, fontWeight: 800, color: F_BLUE, margin: "8px 0 4px" }}>¡Bueno verte por acá!</h1>
              <p style={{ color: "#64748b", marginTop: 6, fontSize: 14 }}>{getTodayStr()}</p>
              <p style={{ color: "#22c55e", fontSize: 12, fontWeight: 600, marginTop: 4 }}>✅ Conectado a la base de datos</p>
              <button style={btnP} onClick={() => setStep(p => p + 1)}>Empezar →</button>
            </div>}
            {s === "promotor" && <div>
              <p style={{ color: "#6366f1", fontWeight: 700, fontSize: 11, margin: "0 0 8px" }}>PASO 1 DE 7</p>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", margin: "0 0 16px" }}>¿Quién sos vos?</h2>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {PROMOTORES.map(p => <Pill key={p} label={p} selected={form.promotor === p} onClick={() => setForm(f => ({ ...f, promotor: p }))} />)}
              </div>
              <input placeholder="O escribí tu nombre..." style={inp} value={PROMOTORES.includes(form.promotor) ? "" : form.promotor} onChange={e => setForm(f => ({ ...f, promotor: e.target.value }))} />
              <button style={{ ...btnP, opacity: form.promotor ? 1 : 0.4 }} disabled={!form.promotor} onClick={() => setStep(p => p + 1)}>Siguiente →</button>
              <button style={btnS} onClick={() => setStep(p => p - 1)}>← Atrás</button>
            </div>}
            {s === "sucursal" && <div>
              <p style={{ color: "#6366f1", fontWeight: 700, fontSize: 11, margin: "0 0 8px" }}>PASO 2 DE 7</p>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", margin: "0 0 16px" }}>¿En qué sucursal estás hoy?</h2>
              {SUCURSALES.map(s => <SucPill key={s} suc={s} />)}
              <button style={{ ...btnP, opacity: form.sucursal ? 1 : 0.4 }} disabled={!form.sucursal} onClick={() => setStep(p => p + 1)}>Siguiente →</button>
              <button style={btnS} onClick={() => setStep(p => p - 1)}>← Atrás</button>
            </div>}
            {s === "vendedor" && <div>
              <p style={{ color: "#6366f1", fontWeight: 700, fontSize: 11, margin: "0 0 8px" }}>PASO 3 DE 7</p>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", margin: "0 0 16px" }}>¿Quién es el vendedor hoy?</h2>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {VENDEDORES.map(v => <Pill key={v} label={v} selected={form.vendedor === v} onClick={() => setForm(f => ({ ...f, vendedor: v }))} />)}
              </div>
              <input placeholder="O escribí su nombre..." style={inp} value={VENDEDORES.includes(form.vendedor) ? "" : form.vendedor} onChange={e => setForm(f => ({ ...f, vendedor: e.target.value }))} />
              <button style={{ ...btnP, opacity: form.vendedor ? 1 : 0.4 }} disabled={!form.vendedor} onClick={() => setStep(p => p + 1)}>Siguiente →</button>
              <button style={btnS} onClick={() => setStep(p => p - 1)}>← Atrás</button>
            </div>}
            {s === "pasajero" && <div>
              <p style={{ color: "#6366f1", fontWeight: 700, fontSize: 11, margin: "0 0 8px" }}>PASO 4 DE 7</p>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", margin: "0 0 6px" }}>¿Cómo se llama el contacto?</h2>
              <input placeholder="Ej: Juan, La familia del centro..." style={inp} value={form.pasajero} onChange={e => setForm(f => ({ ...f, pasajero: e.target.value }))} />
              <div style={{ marginTop: 14 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", margin: "0 0 2px" }}>📱 WhatsApp (opcional)</p>
                <div style={{ display: "flex", alignItems: "center" }}>
                  <span style={{ padding: "11px 12px", borderRadius: "12px 0 0 12px", border: "1px solid #e2e8f0", borderRight: "none", background: "#f8fafc", fontSize: 13, color: "#64748b" }}>+</span>
                  <input type="tel" placeholder="54 9 11 1234 5678" style={{ ...inp, marginTop: 0, borderRadius: "0 12px 12px 0", flex: 1 }} value={form.whatsapp || ""} onChange={e => setForm(f => ({ ...f, whatsapp: e.target.value }))} />
                </div>
              </div>
              <button style={{ ...btnP, opacity: form.pasajero ? 1 : 0.4 }} disabled={!form.pasajero} onClick={() => setStep(p => p + 1)}>Siguiente →</button>
              <button style={btnS} onClick={() => setStep(p => p - 1)}>← Atrás</button>
            </div>}
            {s === "grupo" && <div>
              <p style={{ color: "#6366f1", fontWeight: 700, fontSize: 11, margin: "0 0 8px" }}>PASO 5 DE 7</p>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", margin: "0 0 14px" }}>¿Cuántas personas?</h2>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <button key={n} onClick={() => setForm(f => ({ ...f, grupoSize: n }))} style={{ width: 48, height: 48, borderRadius: 12, border: "2px solid " + (form.grupoSize === n ? "#6366f1" : "#e2e8f0"), background: form.grupoSize === n ? "#6366f1" : "white", color: form.grupoSize === n ? "white" : "#1e293b", fontWeight: 700, fontSize: 15, cursor: "pointer" }}>{n}</button>
                ))}
              </div>
              <button style={btnP} onClick={() => setStep(p => p + 1)}>Siguiente →</button>
              <button style={btnS} onClick={() => setStep(p => p - 1)}>← Atrás</button>
            </div>}
            {s === "intereses" && <div>
              <p style={{ color: "#6366f1", fontWeight: 700, fontSize: 11, margin: "0 0 8px" }}>PASO 6 DE 7</p>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", margin: "0 0 12px" }}>¿Qué productos les interesan?</h2>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {INTERESES.map(i => <Pill key={i} label={i} selected={form.intereses.includes(i)} onClick={() => setForm(f => ({ ...f, intereses: f.intereses.includes(i) ? f.intereses.filter(x => x !== i) : [...f.intereses, i] }))} />)}
              </div>
              <button style={{ ...btnP, opacity: form.intereses.length ? 1 : 0.4 }} disabled={!form.intereses.length} onClick={() => setStep(p => p + 1)}>Siguiente →</button>
              <button style={btnS} onClick={() => setStep(p => p - 1)}>← Atrás</button>
            </div>}
            {s === "fase" && <div>
              <p style={{ color: "#6366f1", fontWeight: 700, fontSize: 11, margin: "0 0 8px" }}>PASO 7 DE 7</p>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", margin: "0 0 16px" }}>¿Hasta dónde llegó?</h2>
              {[["calle", "🗣 Solo hablé en la calle", "Contacto registrado"], ["ingreso", "🏢 Ingresaron a la oficina", "Actualizo el resultado después"]].map(([fase, titulo, sub]) => (
                <button key={fase} onClick={() => !saving && submitForm(fase)} disabled={saving}
                  style={{ width: "100%", textAlign: "left", padding: "13px 16px", borderRadius: 14, border: "2px solid #e2e8f0", background: "white", cursor: "pointer", marginBottom: 8 }}>
                  <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{titulo}</p>
                  <p style={{ margin: "2px 0 0", fontSize: 11, color: "#94a3b8" }}>{sub}</p>
                </button>
              ))}
              <div style={{ border: "2px solid #e2e8f0", borderRadius: 14, padding: "13px 16px", marginBottom: 8 }}>
                <p style={{ margin: "0 0 2px", fontWeight: 700, fontSize: 13, color: "#1e293b" }}>💰 Ingresaron y se vendió</p>
                <input type="number" placeholder="Monto en $ ARS..." style={{ ...inp, marginTop: 6 }} value={form.monto} onChange={e => setForm(f => ({ ...f, monto: e.target.value }))} />
                <button onClick={() => !saving && submitForm("vendido")} disabled={saving || !form.monto}
                  style={{ background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "white", border: "none", borderRadius: 12, padding: "13px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%", marginTop: 8, opacity: form.monto && !saving ? 1 : 0.4 }}>
                  {saving ? "Guardando..." : "Registrar venta ✅"}
                </button>
              </div>
              <button style={btnS} onClick={() => setStep(p => p - 1)}>← Atrás</button>
            </div>}
          </div>
        </div>
      )}

      {/* DASHBOARD */}
      {privacyMode && (
        <div style={{ background: "#fef3c7", borderTop: "3px solid #f59e0b", padding: "8px 20px", display: "flex", alignItems: "center", gap: 8, position: "sticky", top: 60, zIndex: 90 }}>
          <span style={{ fontSize: 16 }}>🙈</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#92400e" }}>Modo privacidad activo — los montos están ocultos</span>
          <button onClick={() => setPrivacyMode(false)} style={{ marginLeft: "auto", padding: "4px 12px", borderRadius: 8, border: "none", background: "#f59e0b", color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>Mostrar</button>
        </div>
      )}
      {view === "dashboard" && (
        <div style={{ maxWidth: 1100, margin: "0 auto", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 10, margin: "16px 0 14px" }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", margin: "0 0 3px" }}>Dashboard 📊</h2>
              <p style={{ color: "#64748b", fontSize: 12 }}>{getTodayStr()}</p>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#ede9fe", borderRadius: 8, padding: "4px 10px", marginTop: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#6366f1" }}>🏆 Semana actual: {fmtDate(weekRange.sat)} → {fmtDate(weekRange.fri)}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={() => exportCSV(currentWeekRegistros)} style={{ padding: "7px 16px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "white" }}>⬇️ Exportar CSV</button>
              {[["operativo", "⚡ Operativo"], ["analitico", "📈 Analítico"]].map(([t, l]) => (
                <button key={t} onClick={() => setDashTab(t)} style={{ padding: "7px 16px", borderRadius: 10, border: "none", fontWeight: 700, fontSize: 12, cursor: "pointer", background: dashTab === t ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#f1f5f9", color: dashTab === t ? "white" : "#64748b" }}>{l}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(120px,1fr))", gap: 10, marginBottom: 16 }}>
            {[["👥 Contactados", totalPersonas, "personas", "#6366f1"], ["🏢 Ingresaron", totalIngresaron, "a oficina", "#0ea5e9"], ["💰 Vendidos", totalVendidos, "clientes", "#22c55e"], ["💵 Facturado", hideMoney(totalMonto), "", "#f59e0b"], ["🎯 Conversión", convRate + "%", "total", "#8b5cf6"], ["🎫 Ticket", hideMoney(avgTicket), "promedio", "#14b8a6"], ["⏳ En oficina", enOficina.length, "sin cierre", "#ef4444"]].map(([l, v, sub, c]) => (
              <div key={l} style={{ background: "white", borderRadius: 14, padding: "12px", boxShadow: "0 2px 10px rgba(0,0,0,0.05)", borderTop: "3px solid " + c }}>
                <p style={{ margin: 0, fontSize: 10, color: "#94a3b8", fontWeight: 600 }}>{l}</p>
                <p style={{ margin: "3px 0 1px", fontSize: 18, fontWeight: 800, color: "#1e293b", lineHeight: 1.2 }}>{v}</p>
                {sub && <p style={{ margin: 0, fontSize: 10, color: "#94a3b8" }}>{sub}</p>}
              </div>
            ))}
          </div>
          {dashTab === "operativo" && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
              <div style={{ background: "white", borderRadius: 18, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                <h3 style={{ margin: "0 0 16px", fontSize: 14, fontWeight: 700 }}>🎯 Embudo</h3>
                <div style={{ display: "flex", justifyContent: "space-around" }}>
                  <MiniPie value={totalPersonas} max={300} color="#6366f1" label="Contactos" sub="meta 300" />
                  <MiniPie value={totalIngresaron} max={180} color="#0ea5e9" label="Ingresos" sub="meta 180" />
                  <MiniPie value={totalVendidos} max={120} color="#22c55e" label="Ventas" sub="meta 120" />
                  <MiniPie value={parseFloat(convRate)} max={100} color="#f59e0b" label="Conv." sub="%" />
                </div>
              </div>
              <div style={{ background: "white", borderRadius: 18, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>🏆 Promotores</h3>
                {Object.keys(metrics.byPromotor).length === 0 && <p style={{ color: "#94a3b8", fontSize: 12 }}>Sin datos esta semana</p>}
                {Object.entries(metrics.byPromotor).sort((a, b) => calcPuntos(b[1]) - calcPuntos(a[1])).map(([n, d], i) => {
                  const nv = nivelPromotor(n);
                  return (
                    <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "8px 10px", borderRadius: 10, background: "#f8fafc" }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: "#94a3b8", width: 18 }}>{i + 1}</span>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{n}</p>
                        <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>{d.personas} cont · {d.ingresaron} ing · {d.vendidos} ventas</p>
                      </div>
                      <span style={{ background: nv.color + "22", color: nv.color, padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>{nv.nivel}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ background: "white", borderRadius: 18, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>💼 Vendedores</h3>
                {Object.keys(metrics.byVendedor).length === 0 && <p style={{ color: "#94a3b8", fontSize: 12 }}>Sin ventas esta semana</p>}
                {Object.entries(metrics.byVendedor).sort((a, b) => b[1].monto - a[1].monto).map(([n, d], i) => (
                  <div key={n} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, padding: "8px 10px", borderRadius: 10, background: "#f8fafc" }}>
                    <span style={{ fontSize: 14, fontWeight: 800, color: "#94a3b8", width: 18 }}>{i + 1}</span>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#1e293b" }}>{n}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#64748b" }}>{d.ventas} ventas · {hideMoney(d.monto)}</p>
                    </div>
                    {i === 0 && <span style={{ background: "#f59e0b22", color: "#f59e0b", padding: "3px 10px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>🥇 Líder</span>}
                  </div>
                ))}
              </div>
              <div style={{ background: "white", borderRadius: 18, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>📍 Por sucursal</h3>
                {sucursalPieData.length === 0 ? <p style={{ color: "#94a3b8", fontSize: 12, textAlign: "center", marginTop: 30 }}>Sin ventas</p> : (
                  <ResponsiveContainer width="100%" height={160}>
                    <PieChart>
                      <Pie data={sucursalPieData} cx="40%" cy="50%" outerRadius={65} dataKey="value" label={({ percent }) => Math.round(percent * 100) + "%"} labelLine={false} fontSize={11}>
                        {sucursalPieData.map((e, i) => <Cell key={i} fill={SUC_COLORS[e.name] || COLORS[i]} />)}
                      </Pie>
                      <Tooltip formatter={(v, n, p) => [v + " ventas · " + hideMoney(p.payload.monto), p.payload.name]} />
                      <Legend iconSize={10} layout="vertical" align="right" verticalAlign="middle" wrapperStyle={{ fontSize: 11 }} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )}
          {dashTab === "analitico" && (
            <div>
              <div style={{ background: "white", borderRadius: 18, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.05)", marginBottom: 14 }}>
                <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Actividad por promotor</h3>
                {promotorBarData.length === 0 ? <p style={{ color: "#94a3b8", fontSize: 12 }}>Sin datos</p> : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={promotorBarData} margin={{ left: -20 }}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 10 }} />
                      <Tooltip /><Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Contactos" fill="#6366f1" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Ingresos" fill="#0ea5e9" radius={[3, 3, 0, 0]} />
                      <Bar dataKey="Vendidos" fill="#22c55e" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={{ background: "white", borderRadius: 18, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.05)", marginBottom: 14 }}>
                <h3 style={{ margin: "0 0 14px", fontSize: 14, fontWeight: 700 }}>Intereses más frecuentes</h3>
                {interesesData.length === 0 ? <p style={{ color: "#94a3b8", fontSize: 12, textAlign: "center" }}>Sin datos</p> : (
                  <ResponsiveContainer width="100%" height={200}>
                    <PieChart><Pie data={interesesData} cx="50%" cy="50%" outerRadius={75} dataKey="value" label={({ percent }) => Math.round(percent * 100) + "%"} labelLine={false} fontSize={10}>
                      {interesesData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie><Tooltip /><Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} /></PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              <div style={{ background: "white", borderRadius: 18, padding: 20, boxShadow: "0 2px 10px rgba(0,0,0,0.05)" }}>
                <h3 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 700 }}>Estadísticas semana actual</h3>
                <table style={{ width: "100%", fontSize: 12 }}><tbody>
                  {[["Registros semana", currentWeekRegistros.length], ["Personas contactadas", totalPersonas], ["Ingresaron", totalIngresaron], ["Vendidos", totalVendidos], ["Con WhatsApp", currentWeekRegistros.filter(r => r.whatsapp).length], ["Tasa contacto→ingreso", totalPersonas > 0 ? ((totalIngresaron / totalPersonas) * 100).toFixed(1) + "%" : "—"], ["Tasa ingreso→venta", totalIngresaron > 0 ? ((totalVendidos / totalIngresaron) * 100).toFixed(1) + "%" : "—"], ["Facturado semana", hideMoney(totalMonto)], ["Ticket promedio", hideMoney(avgTicket)]].map(([k, v]) => (
                    <tr key={k} style={{ borderBottom: "1px solid #f1f5f9" }}>
                      <td style={{ padding: "7px 0", color: "#64748b" }}>{k}</td>
                      <td style={{ padding: "7px 0", fontWeight: 700, color: "#1e293b", textAlign: "right" }}>{v}</td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* LISTA */}
      {view === "lista" && (
        <div style={{ maxWidth: 900, margin: "0 auto", padding: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "16px 0", flexWrap: "wrap", gap: 10 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "#1e293b", margin: 0 }}>Registros 👥</h2>
              <p style={{ fontSize: 12, color: "#22c55e", marginTop: 4, fontWeight: 600 }}>✅ {registros.length} registros totales · {currentWeekRegistros.length} esta semana</p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={cargar} style={{ padding: "9px 16px", borderRadius: 10, border: "1px solid #e2e8f0", background: "white", fontSize: 12, fontWeight: 700, cursor: "pointer", color: "#64748b" }}>🔄 Actualizar</button>
              <button onClick={() => { setView("form"); setStep(0); }} style={{ padding: "9px 20px", borderRadius: 10, border: "none", background: F_ORANGE, color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+ Nuevo</button>
            </div>
          </div>
          {enOficina.length > 0 && (
            <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 12, padding: "10px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 18 }}>⏳</span>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: "#92400e" }}>{enOficina.length} grupo(s) en oficina esperando resultado</p>
            </div>
          )}
          {registros.length === 0 && !loading && <div style={{ textAlign: "center", padding: 60, color: "#94a3b8" }}><div style={{ fontSize: 44 }}>📋</div><p style={{ fontWeight: 600, marginTop: 10 }}>Sin registros todavía</p></div>}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {registros.map(r => {
              const bc = r.vendido ? "#22c55e" : r.retorno ? "#8b5cf6" : r.ingreso ? "#0ea5e9" : "#e2e8f0";
              const sc = SUC_COLORS[r.sucursal] || "#94a3b8";
              const editable = isEditable(r);
              const mins = minutosRestantes(r);
              return (
                <div key={r.id} style={{ background: "white", borderRadius: 14, padding: "14px 18px", boxShadow: "0 2px 8px rgba(0,0,0,0.05)", borderLeft: "4px solid " + bc }}>
                  <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                        <p style={{ margin: 0, fontWeight: 800, fontSize: 14, color: "#1e293b" }}>{r.pasajero}</p>
                        <StatusBadge r={r} />
                        <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 10, fontWeight: 700, background: sc + "18", color: sc }}>📍 {r.sucursal}</span>
                        <span style={{ fontSize: 11, color: "#94a3b8" }}>{r.hora} · {r.fecha}</span>
                        {editable && <span style={{ fontSize: 10, color: "#22c55e", fontWeight: 600 }}>✏️ editable {mins}min</span>}
                      </div>
                      <p style={{ margin: "0 0 2px", fontSize: 12, color: "#64748b" }}><b>{r.promotor}</b> → <b>{r.vendedor}</b> · {r.grupoSize || 1} persona(s){r.whatsapp && <span style={{ color: "#22c55e" }}> · 📱 {r.whatsapp}</span>}</p>
                      <p style={{ margin: 0, fontSize: 11, color: "#94a3b8" }}>{(r.intereses || []).join(", ")}{r.monto > 0 && <span style={{ color: "#22c55e", fontWeight: 700 }}> · {hideMoney(r.monto)}</span>}</p>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, alignSelf: "flex-start" }}>
                      {r.ingreso && r.vendido === null && (
                        <button onClick={() => { setUpdateModal(r); setUpdateData({ vendido: null, monto: "" }); }} style={{ padding: "6px 10px", borderRadius: 8, background: "#fef3c7", color: "#92400e", border: "1px solid #fcd34d", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>✏️ Actualizar</button>
                      )}
                      {!r.ingreso && r.vendido === false && (
                        <button onClick={() => marcarRetorno(r)} style={{ padding: "6px 10px", borderRadius: 8, background: "#ede9fe", color: "#6366f1", border: "1px solid #c4b5fd", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>🔄 Retornó</button>
                      )}
                      {editable && (
                        <button onClick={() => { setEditForm({ ...r }); setEditModal(r); }} style={{ padding: "6px 10px", borderRadius: 8, background: "#f0f9ff", color: "#0ea5e9", border: "1px solid #bae6fd", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>✏️ Editar</button>
                      )}
                      {editable && (
                        <button onClick={() => borrar(r.id)} style={{ padding: "6px 10px", borderRadius: 8, background: "#fff1f2", color: "#ef4444", border: "1px solid #fecdd3", fontWeight: 700, fontSize: 11, cursor: "pointer" }}>🗑 Borrar</button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL ACTUALIZAR */}
      {updateModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }}>
          <div style={{ background: "white", borderRadius: 20, padding: 26, maxWidth: 380, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.18)" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 800, color: "#1e293b" }}>¿Cómo terminó?</h3>
            <p style={{ margin: "0 0 18px", fontSize: 13, color: "#64748b" }}>Grupo: <b>{updateModal.pasajero}</b> · {updateModal.grupoSize || 1} persona(s)</p>
            <div style={{ display: "flex", gap: 10, marginBottom: 14 }}>
              {[[true, "🎉 Se vendió", "#22c55e"], [false, "❌ No se vendió", "#ef4444"]].map(([v, l, c]) => (
                <button key={l} onClick={() => setUpdateData(d => ({ ...d, vendido: v }))} style={{ flex: 1, padding: "12px 6px", borderRadius: 12, border: "2px solid " + (updateData.vendido === v ? c : "#e2e8f0"), background: updateData.vendido === v ? c + "18" : "white", color: updateData.vendido === v ? c : "#64748b", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{l}</button>
              ))}
            </div>
            {updateData.vendido === true && <input type="number" placeholder="Monto en $ ARS..." style={{ ...inp, marginBottom: 12 }} value={updateData.monto} onChange={e => setUpdateData(d => ({ ...d, monto: e.target.value }))} />}
            <button onClick={confirmUpdate} style={{ background: F_ORANGE, color: "white", border: "none", borderRadius: 12, padding: "13px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%", marginTop: 4, opacity: (updateData.vendido !== null && (updateData.vendido === false || updateData.monto)) ? 1 : 0.4 }} disabled={updateData.vendido === null || (updateData.vendido === true && !updateData.monto)}>Confirmar</button>
            <button onClick={() => setUpdateModal(null)} style={{ background: "#f8fafc", color: F_BLUE, border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8, width: "100%" }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* MODAL EDITAR */}
      {editModal && editForm && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20, overflowY: "auto" }}>
          <div style={{ background: "white", borderRadius: 20, padding: 26, maxWidth: 440, width: "100%", boxShadow: "0 8px 40px rgba(0,0,0,0.2)" }}>
            <h3 style={{ margin: "0 0 16px", fontSize: 18, fontWeight: 800, color: "#1e293b" }}>✏️ Editar registro</h3>
            {[["Nombre del contacto", "pasajero", "text"], ["WhatsApp", "whatsapp", "tel"], ["Monto $ ARS", "monto", "number"]].map(([label, field, type]) => (
              <div key={field} style={{ marginBottom: 12 }}>
                <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, color: "#64748b" }}>{label}</p>
                <input type={type} style={inp} value={editForm[field] || ""} onChange={e => setEditForm(f => ({ ...f, [field]: e.target.value }))} placeholder={label} />
              </div>
            ))}
            <div style={{ marginBottom: 12 }}>
              <p style={{ margin: "0 0 4px", fontSize: 12, fontWeight: 700, color: "#64748b" }}>Tamaño del grupo</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                  <button key={n} onClick={() => setEditForm(f => ({ ...f, grupoSize: n }))} style={{ width: 40, height: 40, borderRadius: 10, border: "2px solid " + (editForm.grupoSize === n ? "#6366f1" : "#e2e8f0"), background: editForm.grupoSize === n ? "#6366f1" : "white", color: editForm.grupoSize === n ? "white" : "#1e293b", fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{n}</button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <p style={{ margin: "0 0 6px", fontSize: 12, fontWeight: 700, color: "#64748b" }}>Intereses</p>
              <div style={{ display: "flex", flexWrap: "wrap" }}>
                {INTERESES.map(i => (
                  <button key={i} onClick={() => setEditForm(f => ({ ...f, intereses: (f.intereses || []).includes(i) ? (f.intereses || []).filter(x => x !== i) : [...(f.intereses || []), i] }))}
                    style={{ padding: "6px 12px", borderRadius: 50, border: "2px solid " + ((editForm.intereses || []).includes(i) ? "#6366f1" : "#e2e8f0"), background: (editForm.intereses || []).includes(i) ? "#6366f1" : "white", color: (editForm.intereses || []).includes(i) ? "white" : "#64748b", fontWeight: 600, fontSize: 12, cursor: "pointer", margin: "3px" }}>{i}</button>
                ))}
              </div>
            </div>
            <button onClick={saveEdit} style={{ background: "#22c55e", color: "white", border: "none", borderRadius: 12, padding: "13px 24px", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}>Guardar cambios ✅</button>
            <button onClick={() => { setEditModal(null); setEditForm(null); }} style={{ background: "#f8fafc", color: F_BLUE, border: "1px solid #e2e8f0", borderRadius: 12, padding: "10px 20px", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 8, width: "100%" }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}
