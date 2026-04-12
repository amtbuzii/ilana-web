"""
Binary performance data parsers for AH-64D Saraf/LB (Apache LongBow) flight data files.

All LB formulas are taken directly from Sim.frm (VB6 source) and validated to produce
zero error vs the reference einat1.csv across all 6 waypoints.

File format (cruiseLB, cruise):
  8-byte VB6 Variant records: [VarType=4 (2B)][float32 (4B)][padding (2B)]
  float32 read at byte offset: record_index * 8 + 2

cruiseLB layout (per temperature/altitude band of 1065 slots):
  Slots   0–851  : TRQ data, 6 GW levels × 142 speeds
                   GW offset: ((w-1000)/2000 - 6) × 142  (w=13000 → slot 0)
  Slots 852–992  : Q (stores drag delta-torque), at GW-slot 6 (offset 852)
  Slots 993–1064 : FF data, indexed by Int(torque_pct) - 29

Position formula (LBTORQ, Sim.frm line 6060):
  pos = v-20 + ((w-1000)/2000 - 6)*142 + (t/10+1)*1065 + (h/2000)*1065*6

Position formula (LBFFfnc, Sim.frm line 6173):
  pos = h/2000*1065*6 + (t/10+1)*1065 + 993 + Int(torq) - 29

Position formula (LBQfnc, Sim.frm line 6136):
  pos = v-20 + 6*142 + (t/10+1)*1065 + (h/2000)*1065*6

Axes:
  Speed     : v=20 at slot 0, 1 unit/step, 142 entries per GW level
  GW        : w=13000 (index 0) step 2000 lb; 6 levels (13000–23000)
  Temperature: t=-10 → offset 0, t=0 → 1065, step 10°C; range -10 to +40
  Altitude  : h=0 → offset 0, h=2000 → 6390, step 2000 ft; range 0–10000

OGE / PA / ffALPHA files use separate formats (see class docstrings).
"""

import math
import struct
import numpy as np
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent.parent.parent / "einat"

# ── PA table axes ──────────────────────────────────────────────────────────────
PA_ALT_FT = [0, 2000, 4000, 6000, 8000, 10000, 12000]   # 7 levels

# ── OGE table axes ─────────────────────────────────────────────────────────────
OGE_WEIGHTS_LBS = [14000, 15000, 16000, 17000, 18000, 19000, 20000, 21000]

# OGdt from Sim.frm line 6234 — density altitude coefficients per 20°C band
# OGdt(0)=-20°C, OGdt(1)=0°C, OGdt(2)=20°C, OGdt(3)=40°C
_OGDT = [(1.26, -4444), (1.24, -1805), (1.22, 555), (1.18, 2777)]


def _og_density_h(alt_ft: float, temp_c: float) -> int:
    """
    Convert (pressure altitude, OAT) → OGE table h index using VB6 OGfinder formula.
    Sim.frm line 6211: tmp1 = Int((tmp - 0.1) / 20) * 20
    h = Round((Hdns12 + 5000) / 100), clamped to 0–200.
    """
    tmp1 = math.floor((temp_c - 0.1) / 20.0) * 20
    i = (tmp1 + 20) // 20
    i = max(0, min(i, 2))          # keep i+1 within bounds of _OGDT
    a1, b1 = _OGDT[i]
    a2, b2 = _OGDT[i + 1]
    hdns1  = a1 * alt_ft + b1
    hdns2  = a2 * alt_ft + b2
    hdns12 = hdns1 + (temp_c - tmp1) / 20.0 * (hdns2 - hdns1)
    h = round((hdns12 + 5000) / 100.0)
    return max(0, min(h, 200))

# ── RCdt table from Sim.frm Rcdata() ──────────────────────────────────────────
_RCDT = {
    14: 4100 / 80, 15: 3800 / 80, 16: 3600 / 80, 17: 3350 / 80,
    18: 3200 / 80, 19: 3000 / 80, 20: 2850 / 80,
    21: 2700 / 80, 22: 2550 / 80, 23: 2400 / 80,
}

# ── cDRAGxb from Einat.ini lines 5-8 (negative values) ───────────────────────
# combFORM.ListIndex=0→1 bidon, 1→2 bidons (default), 2→3, 3→4
_CDRAG = {1: -0.651, 2: -0.81, 3: -0.897, 4: -1.05}
DEFAULT_N_BIDONS = 2


# ── Low-level float reader for VB6 Variant random-file format ─────────────────

def _read_float(raw: bytes, record_idx: int) -> float:
    """
    Read the float32 payload from a VB6 Variant random-access record.

    Each record is 8 bytes: [VarType (2B LE)] [float32 (4B LE)] [padding (2B)].
    VarType=4 means Single (float32).  Records start at byte record_idx * 8.
    Returns 0.0 for out-of-bounds or non-float records.
    """
    byte_off = record_idx * 8
    if byte_off < 0 or byte_off + 6 > len(raw):
        return 0.0
    vtype = struct.unpack_from('<H', raw, byte_off)[0]
    if vtype != 4:
        return 0.0
    return float(struct.unpack_from('<f', raw, byte_off + 2)[0])


# ── LB cruise torque / Q / FF tables ──────────────────────────────────────────

class LBTorqueTable:
    """
    LB (Saraf/LongBow) cruise torque required, stores drag (Q), and fuel flow.

    Implements exactly:
      - LBTORQ raw lookup         (Sim.frm line 6054)
      - LBTorqFinder trilinear    (Sim.frm line 5993)
      - LBQfnc + LBQFinder        (Sim.frm line 6132/6139)
      - LBFFfnc + FFfinder        (Sim.frm line 6167/6178)

    Usage in performance loop:
      trq_raw = table.query(alt, oat, spd, gw)
      q       = table.query_q(alt, oat, spd)
      trq_adj = trq_raw + rcfnc + q * drag
      ff      = table.query_ff(alt, oat, trq_adj)
    """

    def __init__(self, path: Path):
        self._raw = path.read_bytes()

    # -- LBTORQ single-cell lookup -------------------------------------------

    def _lbtorq(self, h: int, t: int, w: int, v: int) -> float:
        """Raw LBTORQ table lookup with clamping (Sim.frm line 6054)."""
        if t > 40: t = 40
        if h == 10000 and t >= 30: t = 30
        if h < 0: h = 0
        pos = int(v - 20 + ((w - 1000) / 2000 - 6) * 142
                  + (t / 10 + 1) * 1065
                  + (h / 2000) * 1065 * 6)
        val = _read_float(self._raw, pos)
        if val == 0.0: val = 100.0
        if val > 100.0: val = 100.0
        return val

    def _lb23exist(self, h: int, t: int) -> bool:
        """Check if the w=23000 GW slot exists for this (h, t) (Sim.frm line 6065)."""
        if t > 40: t = 40
        if h == 10000 and t >= 30: t = 30
        if h < 0: h = 0
        pos = int(140 + (t / 10 + 1) * 1065 + (h / 2000) * 1065 * 6)
        return _read_float(self._raw, pos) == 1.0

    # -- LBTorqFinder trilinear interpolation --------------------------------

    def query(self, alt_ft: float, oat_c: float, airspeed_kts: float,
              atf: float = 1.0, gw_lbs: float = 17500.0) -> float:
        """
        Cruise torque required (%) via LBTorqFinder trilinear interpolation.
        atf is accepted for interface compatibility but not used (LB has no ATF correction).
        """
        HIGH = float(alt_ft)
        tmp  = float(oat_c)
        v    = int(airspeed_kts)
        W    = float(gw_lbs)

        W1 = int((W - 1000) / 2000) * 2000 + 1000
        W2 = W1 + 2000
        if tmp >= 40.0: tmp = 39.9999
        tmp1 = int(tmp / 10) * 10
        tmp2 = tmp1 + 10
        H1 = int(HIGH / 2000) * 2000
        H2 = H1 + 2000

        if W1 < 21000:
            T1 = self._lbtorq(H1, tmp1, W1, v)
            T2 = self._lbtorq(H1, tmp1, W2, v)
            T3 = self._lbtorq(H1, tmp2, W1, v)
            T4 = self._lbtorq(H1, tmp2, W2, v)
            T5 = self._lbtorq(H2, tmp1, W1, v)
            T6 = self._lbtorq(H2, tmp1, W2, v)
            T7 = self._lbtorq(H2, tmp2, W1, v)
            T8 = self._lbtorq(H2, tmp2, W2, v)
        else:
            W1 = 21000
            T1 = self._lbtorq(H1, tmp1, 21000, v)
            T2 = self._lbtorq(H1, tmp1, 23000, v) if self._lb23exist(H1, tmp1) \
                 else 2 * T1 - self._lbtorq(H1, tmp1, 19000, v)
            T3 = self._lbtorq(H1, tmp2, 21000, v)
            T4 = self._lbtorq(H1, tmp2, 23000, v) if self._lb23exist(H1, tmp2) \
                 else 2 * T3 - self._lbtorq(H1, tmp2, 19000, v)
            T5 = self._lbtorq(H2, tmp1, 21000, v)
            T6 = self._lbtorq(H2, tmp1, 23000, v) if self._lb23exist(H2, tmp1) \
                 else 2 * T5 - self._lbtorq(H2, tmp1, 19000, v)
            T7 = self._lbtorq(H2, tmp2, 21000, v)
            T8 = self._lbtorq(H2, tmp2, 23000, v) if self._lb23exist(H2, tmp2) \
                 else 2 * T7 - self._lbtorq(H2, tmp2, 19000, v)

        Trq12   = T1 + (W - W1) * (T2 - T1) / 2000
        Trq34   = T3 + (W - W1) * (T4 - T3) / 2000
        Trq56   = T5 + (W - W1) * (T6 - T5) / 2000
        Trq78   = T7 + (W - W1) * (T8 - T7) / 2000
        Trq1234 = Trq12 + (tmp - tmp1) * (Trq34 - Trq12) / 10
        Trq5678 = Trq56 + (tmp - tmp1) * (Trq78 - Trq56) / 10
        return Trq1234 + (HIGH - H1) * (Trq5678 - Trq1234) / 2000

    # -- LBQFinder (stores drag delta-torque) --------------------------------

    def _lbqfnc(self, h: int, t: int, v: int) -> float:
        """LBQfnc raw lookup (Sim.frm line 6132). GW-slot 6 = stores drag data."""
        if h == 10000 and t >= 30: t = 3   # exact VB6 (typo in source)
        pos = int(v - 20 + 6 * 142 + (t / 10 + 1) * 1065 + (h / 2000) * 1065 * 6)
        return _read_float(self._raw, pos)

    def query_q(self, alt_ft: float, oat_c: float, airspeed_kts: float) -> float:
        """Stores drag delta-torque Q via LBQFinder bilinear (Sim.frm line 6139)."""
        HIGH = float(alt_ft)
        tmp  = float(oat_c)
        v    = int(airspeed_kts)
        H1 = int(HIGH / 2000) * 2000; H2 = H1 + 2000
        t1 = int(tmp / 10) * 10;       t2 = t1 + 10
        q1 = self._lbqfnc(H1, t1, v); q2 = self._lbqfnc(H1, t2, v)
        q3 = self._lbqfnc(H2, t1, v); q4 = self._lbqfnc(H2, t2, v)
        q12 = q1 + (tmp - t1) * (q2 - q1) / 10
        q34 = q3 + (tmp - t1) * (q4 - q3) / 10
        return q12 + (HIGH - H1) * (q34 - q12) / 2000

    # -- LBFFfnc + FFfinder --------------------------------------------------

    def _lbffnc(self, h: int, t: int, trq: float) -> float:
        """LBFFfnc single lookup (Sim.frm line 6167). FF = table_val + 600."""
        if h > 10000: h = 10000
        if h == 10000 and t >= 30: t = 30
        if h < 0: h = 0
        if trq < 29: trq = 29
        pos = int(h / 2000 * 1065 * 6 + (t / 10 + 1) * 1065 + 993 + int(trq) - 29)
        val = _read_float(self._raw, pos)
        ff  = val + 600.0
        if ff == 600.0 and trq > 90: ff = 1400.0
        return ff

    def query_ff(self, alt_ft: float, oat_c: float, trq_adj: float) -> float:
        """
        Fuel flow (lb/hr, both engines) via FFfinder bilinear (Sim.frm line 6178).
        trq_adj is the fully corrected torque (after RcFnc and Q*drag).
        """
        trq = min(100.0, trq_adj)
        tmp = float(oat_c)
        if tmp >= 40.0: tmp = 39.9999
        tmp1 = int(tmp / 10) * 10
        tmp2 = tmp1 + 10
        HIGH = float(alt_ft)
        H1 = int(HIGH / 2000) * 2000
        H2 = H1 + 2000

        f1 = self._lbffnc(H1, tmp1, trq)
        f2 = self._lbffnc(H1, tmp2, trq)
        f3 = self._lbffnc(H2, tmp1, trq)
        f4 = self._lbffnc(H2, tmp2, trq)

        tfrac = (tmp - tmp1) / 10.0
        hfrac = (HIGH - H1) / 2000.0
        ff_H1 = f1 + tfrac * (f2 - f1)
        ff_H2 = f3 + tfrac * (f4 - f3)
        return ff_H1 + hfrac * (ff_H2 - ff_H1)


# ── Peten (standard AH-64D) cruise table ──────────────────────────────────────

class PetenTorqueTable:
    """
    Standard AH-64D cruise torque using TORQ formula (Sim.frm line 5988).
    pos = v-20 + (w/2000-6)*142 + (t/10+1)*923 + (h/2000)*923*6
    Clamping: h>=8000 and t>=20 → t=20.
    GW axis: w=12000 (index 0) step 2000 lb.
    """

    def __init__(self, path: Path):
        self._raw = path.read_bytes()

    def _torq(self, h: int, t: int, w: int, v: int) -> float:
        if t > 40: t = 40
        if h >= 8000 and t >= 20: t = 20
        if h < 0: h = 0
        pos = int(v - 20 + (w / 2000 - 6) * 142 + (t / 10 + 1) * 923 + (h / 2000) * 923 * 6)
        val = _read_float(self._raw, pos)
        if val == 0.0: val = 100.0
        if val > 100.0: val = 100.0
        return val

    def query(self, alt_ft: float, oat_c: float, airspeed_kts: float,
              atf: float = 1.0, gw_lbs: float = 17500.0) -> float:
        """TorqFinder trilinear interpolation (Sim.frm ~line 5900)."""
        HIGH = float(alt_ft)
        tmp  = float(oat_c)
        v    = int(airspeed_kts)
        W    = float(gw_lbs)

        W1 = int(W / 2000) * 2000
        W2 = W1 + 2000
        if tmp >= 40.0: tmp = 39.9999
        tmp1 = int(tmp / 10) * 10; tmp2 = tmp1 + 10
        H1 = int(HIGH / 2000) * 2000; H2 = H1 + 2000

        T1 = self._torq(H1, tmp1, W1, v); T2 = self._torq(H1, tmp1, W2, v)
        T3 = self._torq(H1, tmp2, W1, v); T4 = self._torq(H1, tmp2, W2, v)
        T5 = self._torq(H2, tmp1, W1, v); T6 = self._torq(H2, tmp1, W2, v)
        T7 = self._torq(H2, tmp2, W1, v); T8 = self._torq(H2, tmp2, W2, v)

        Trq12   = T1 + (W - W1) * (T2 - T1) / 2000
        Trq34   = T3 + (W - W1) * (T4 - T3) / 2000
        Trq56   = T5 + (W - W1) * (T6 - T5) / 2000
        Trq78   = T7 + (W - W1) * (T8 - T7) / 2000
        Trq1234 = Trq12 + (tmp - tmp1) * (Trq34 - Trq12) / 10
        Trq5678 = Trq56 + (tmp - tmp1) * (Trq78 - Trq56) / 10
        trq = Trq1234 + (HIGH - H1) * (Trq5678 - Trq1234) / 2000

        # rpmFIX for Peten
        RPM_FIX = 0.8
        return trq - RPM_FIX

    def query_q(self, alt_ft: float, oat_c: float, airspeed_kts: float) -> float:
        """Qfnc stores drag (Sim.frm line 6104); GW-slot 5 in cruise file."""
        HIGH = float(alt_ft)
        tmp  = float(oat_c)
        v    = int(airspeed_kts)
        H1 = int(HIGH / 2000) * 2000; H2 = H1 + 2000
        t1 = int(tmp / 10) * 10;       t2 = t1 + 10

        def qfnc(h, t):
            if h >= 8000 and t > 20: t = 20
            pos = int(v - 20 + 5 * 142 + (t / 10 + 1) * 923 + (h / 2000) * 923 * 6)
            return _read_float(self._raw, pos)

        q1 = qfnc(H1, t1); q2 = qfnc(H1, t2)
        q3 = qfnc(H2, t1); q4 = qfnc(H2, t2)
        q12 = q1 + (tmp - t1) * (q2 - q1) / 10
        q34 = q3 + (tmp - t1) * (q4 - q3) / 10
        return q12 + (HIGH - H1) * (q34 - q12) / 2000

    def query_ff(self, alt_ft: float, oat_c: float, trq_adj: float) -> float:
        """FFfnc + FFfinder for Peten (Sim.frm line 6156/6178)."""
        trq = min(100.0, max(29.0, trq_adj))
        tmp = float(oat_c)
        if tmp >= 40.0: tmp = 39.9999
        tmp1 = int(tmp / 10) * 10; tmp2 = tmp1 + 10
        HIGH = float(alt_ft)
        H1 = int(HIGH / 2000) * 2000; H2 = H1 + 2000

        def ffnc(h, t):
            if h > 10000: h = 10000
            if h >= 8000 and t > 20: t = 20
            if h < 0: h = 0
            pos = int(h / 2000 * 923 * 6 + (t / 10 + 1) * 923 + 851 + int(trq) - 29)
            val = _read_float(self._raw, pos)
            ff  = val + 600.0
            if ff == 600.0 and trq > 90: ff = 1400.0
            return ff

        f1 = ffnc(H1, tmp1); f2 = ffnc(H1, tmp2)
        f3 = ffnc(H2, tmp1); f4 = ffnc(H2, tmp2)
        tfrac = (tmp - tmp1) / 10.0
        hfrac = (HIGH - H1) / 2000.0
        return f1 + tfrac * (f2 - f1) + hfrac * (
            (f3 + tfrac * (f4 - f3)) - (f1 + tfrac * (f2 - f1))
        )


# ── ALPHA fuel flow table (ffALPHA) ───────────────────────────────────────────

def _parse_tag4_blocks(path: Path) -> list:
    """
    Parse a VB6 Variant file into contiguous blocks of VarType=4 (Single) records.

    Scans the file record-by-record (8 bytes each).  Consecutive records with
    VarType=4 are collected into a numpy float32 array; non-type-4 records act as
    block separators and are skipped.  Returns a list of arrays, one per block.
    """
    raw = path.read_bytes()
    n   = len(raw) // 8
    blocks = []
    i = 0
    while i < n:
        if struct.unpack_from('<h', raw, i * 8)[0] == 4:
            j = i
            while j < n and struct.unpack_from('<h', raw, j * 8)[0] == 4:
                j += 1
            vals = np.array(
                [struct.unpack_from('<f', raw, k * 8 + 2)[0] for k in range(i, j)],
                dtype=np.float32,
            )
            blocks.append(vals)
            i = j
        else:
            i += 1
    return blocks


class FFAlphaTable:
    """
    ALPHA-variant fuel flow (lb/hr) vs airspeed, altitude, and FAT.
    32 blocks × 71 points; axes: 8 altitudes × 4 FAT, airspeed 40-180 kts step 2.
    """
    _ALT = [0, 2000, 4000, 6000, 8000, 10000, 12000, 14000]
    _FAT = [-20.0, 0.0, 20.0, 40.0]

    def __init__(self, path: Path):
        self._blocks  = [b for b in _parse_tag4_blocks(path) if len(b) == 71]
        self._alt_arr = np.array(self._ALT, dtype=float)
        self._fat_arr = np.array(self._FAT, dtype=float)

    def query(self, alt_ft: float, fat_c: float, airspeed_kts: float) -> float:
        alt_ft = float(np.clip(alt_ft, self._alt_arr[0],  self._alt_arr[-1]))
        fat_c  = float(np.clip(fat_c,  self._fat_arr[0],  self._fat_arr[-1]))
        spd    = float(np.clip(airspeed_kts, 40.0, 180.0))
        alt_lo = int(np.clip(np.searchsorted(self._alt_arr, alt_ft, 'right') - 1, 0, 6))
        fat_lo = int(np.clip(np.searchsorted(self._fat_arr, fat_c,  'right') - 1, 0, 2))
        af = (alt_ft - self._alt_arr[alt_lo]) / (self._alt_arr[alt_lo+1] - self._alt_arr[alt_lo])
        ff = (fat_c  - self._fat_arr[fat_lo]) / (self._fat_arr[fat_lo+1] - self._fat_arr[fat_lo])
        si = (spd - 40.0) / 2.0
        slo = min(int(si), 69); sfrac = si - int(si)

        def val(ai, fi):
            bi = ai * 4 + fi
            if bi >= len(self._blocks): return 600.0
            b = self._blocks[bi]
            return float(b[slo] * (1 - sfrac) + b[min(slo+1, 70)] * sfrac)

        return float(
            (1-af)*(1-ff)*val(alt_lo,   fat_lo)   + af*(1-ff)*val(alt_lo+1, fat_lo) +
            (1-af)*ff    *val(alt_lo,   fat_lo+1) + af*ff    *val(alt_lo+1, fat_lo+1)
        )


# ── Power Available table ──────────────────────────────────────────────────────

class PATable:
    """
    Power Available (% torque) — VB6-faithful PAfnc / PAfinder / TRfinder.

    File format: raw float32 (Len=4 in VB6 Random file).
    Layout: 2(se) × 7(alt) × 51(temp) records = 714 float32 values.

    PAfnc (Sim.frm line 6257):
      pos = t+10 + (h/2000)*51 + se*357   (0-based)
      raw float32 at byte_off = pos*4

    PAfinder (Sim.frm line 6248):
      H1 = Int(HIGH/2000)*2000; H2 = H1+2000
      PA = PAfnc(H1,t,se) + (HIGH-H1)/2000 * (PAfnc(H2,t,se) - PAfnc(H1,t,se))
      — altitude linear interpolation only; temperature integer lookup

    TRfinder (Sim.frm line 6273):
      Atf = Int(100*ETF)/100; TR=1 if Atf<0.9 or Atf>=1.0
      pos = (Atf-0.9)*100*4+1 (1-indexed in ATF file); reads tmp2,tr2,tmp3,tr3 at pos+1..+4
      Piecewise linear over 4 temperature segments
      tmp4=-15/tr4=1, (tmp3,tr3), (tmp2,tr2), (tmp1=35, tr1=Atf); if tmp>=35: TR=Atf

    Final PA (Sim.frm line 4959):
      PA = PAfinder * TR − rpmFIX   (rpmFIX=0 for LB, 0.8 for Peten/ALPHA)
    """

    def __init__(self, path: Path, atf_path: Path | None = None, rpm_fix: float = 0.0):
        self._raw     = path.read_bytes()          # raw float32 records (Len=4)
        self._atf_raw = atf_path.read_bytes() if atf_path else None
        self._rpm_fix = rpm_fix

    # ── PAfnc raw lookup ──────────────────────────────────────────────────────

    def _pafnc(self, h: int, t: int, se: int = 0) -> float:
        """PAfnc: raw float32 at pos = t+10 + (h/2000)*51 + se*357."""
        if t > 39: t = 39
        if h < 0:  h = 0
        if se == 1 and t > 35: t = 35      # extra clamp for se=1 (Sim.frm line 6263)
        pos = t + 10 + (h // 2000) * 51 + se * 357
        off = pos * 4
        if off < 0 or off + 4 > len(self._raw):
            return 0.0
        return float(struct.unpack_from('<f', self._raw, off)[0])

    # ── TRfinder ──────────────────────────────────────────────────────────────

    def _trfinder(self, etf: float, oat_c: float) -> float:
        """
        TRfinder: engine temperature correction factor (Sim.frm line 6273).
        ATF file uses Len=8 VarType=4 format; reads 4 breakpoints from pos+1..pos+4.
        """
        if self._atf_raw is None:
            return 1.0
        # VB6: a = 100*ETF_avg; Atf = Int(a)/100
        a       = round(etf * 100)      # round() avoids IEEE-754 truncation errors
        atf_val = a / 100.0
        if atf_val < 0.9 or atf_val >= 1.0:
            return 1.0
        tmp = max(-5.0, float(oat_c))  # VB6: If tmp < -5 Then tmp = -5
        tmp1 = 35.0
        tr1  = atf_val

        # Record position in ATF file (1-indexed): pos = (Atf-0.9)*100*4+1
        # VB6 reads at pos+1, pos+2, pos+3, pos+4
        pos_1idx = round((atf_val - 0.9) * 100) * 4 + 1

        def _atf_val(rec_1idx: int) -> float:
            off = (rec_1idx - 1) * 8    # Len=8; skip 2-byte VarType header
            if off + 6 > len(self._atf_raw):
                return 0.0
            return float(struct.unpack_from('<f', self._atf_raw, off + 2)[0])

        tmp2 = _atf_val(pos_1idx + 1)
        tr2  = _atf_val(pos_1idx + 2)
        tmp3 = _atf_val(pos_1idx + 3)
        tr3  = _atf_val(pos_1idx + 4)
        tmp4 = -15.0
        tr4  =  1.0

        if tmp >= 35:
            return atf_val
        elif tmp < tmp3:
            ctr1, ctmp1, ctr2, ctmp2 = tr4, tmp4, tr3, tmp3
        elif tmp < tmp2:
            ctr1, ctmp1, ctr2, ctmp2 = tr3, tmp3, tr2, tmp2
        else:
            ctr1, ctmp1, ctr2, ctmp2 = tr2, tmp2, tr1, tmp1

        return ctr1 + (tmp - ctmp1) / (ctmp2 - ctmp1) * (ctr2 - ctr1)

    # ── PAfinder + TR + rpmFIX ────────────────────────────────────────────────

    def query(self, alt_ft: float, oat_c: float, etf: float = 1.0, rating: int = 0) -> float:
        """
        PA = PAfinder(alt, oat, rating) * TR(etf, oat) − rpmFIX

        PAfinder: linear altitude interpolation, integer temp lookup (no temp interp).
        """
        HIGH = float(alt_ft)
        t    = int(oat_c)                           # integer temperature index
        H1   = int(HIGH / 2000) * 2000
        H2   = H1 + 2000
        pa1  = self._pafnc(H1, t, rating)
        pa2  = self._pafnc(H2, t, rating)
        pa   = pa1 + (HIGH - H1) / 2000.0 * (pa2 - pa1)
        tr   = self._trfinder(etf, oat_c)
        return pa * tr - self._rpm_fix


# ── OGE hover table ────────────────────────────────────────────────────────────

class OGETable:
    """
    OGE hover torque required (%). Shape: (8_weights, 202_entries).
    Entries 0-200: torque at density altitude h (100-ft steps, offset +5000).
    Entry 201: bidon correction value per weight.

    OGfinder (Sim.frm line 6203):
      1. Convert (alt_ft, temp_c) → density altitude index h via _og_density_h()
      2. Read OGfnc(h, W) — integer h, linear interp in weight only
      3. Apply bidon correction: OGE += bid/4 * n_bidons
    IGE = 0.82 * OGE + 0.82  (Sim.frm line 6231)
    """
    def __init__(self, path: Path):
        raw    = path.read_bytes()
        floats = np.frombuffer(raw[:len(raw)//4*4], dtype='<f4').copy()
        self._data = floats.reshape(8, 202)   # [weight_idx, h_or_bidon]

    def _ogfnc(self, h: int, w_lbs: float) -> float:
        """
        OGfnc from Sim.frm line 6239.

        h     : column index — 0–200 for density-alt (100 ft steps, offset +5000),
                or 201 for the per-weight bidon correction value.
        w_lbs : gross weight (lbs); clamped to >=14000 (minimum table entry).
        Returns 125.0 for out-of-envelope cells (Sim.frm line 6245).
        """
        w_lbs = max(14000.0, w_lbs)
        wi = int(w_lbs / 1000) - 14
        wi = max(0, min(wi, 7))
        val = float(self._data[wi, h])
        if val == 0.0:
            val = 125.0   # out-of-envelope clamp (Sim.frm line 6245)
        return val

    def query(self, alt_ft: float, temp_c: float, gross_weight_lbs: float,
              n_bidons: int = 2) -> float:
        """
        Returns OGE torque % with bidon correction applied.
        Mirrors VB6 OGfinder exactly.
        """
        h  = _og_density_h(alt_ft, temp_c)
        W1 = int(gross_weight_lbs / 1000) * 1000
        W2 = W1 + 1000

        if W1 < 21000:
            torq1 = self._ogfnc(h, W1)
            torq2 = self._ogfnc(h, W2)
        else:
            W1    = 21000
            torq1 = self._ogfnc(h, W1)
            torq2 = 2.0 * torq1 - self._ogfnc(h, 20000)

        oge = torq1 + (gross_weight_lbs - W1) / 1000.0 * (torq2 - torq1)

        # Bidon correction (Sim.frm line 6226)
        bid1 = self._ogfnc(201, W1)
        bid2 = self._ogfnc(201, W2)
        bid  = bid1 + (gross_weight_lbs - W1) / 1000.0 * (bid2 - bid1)
        if bid > 10.0:
            bid = 10.0
        oge += bid / 4.0 * n_bidons

        return oge


# ── RcFnc helper (used by performance.py) ─────────────────────────────────────

def rcfnc(dxrc: float, gw_lbs: float) -> float:
    """
    RcFnc from Sim.frm line 6307.
    Converts altitude rate (ft/min) to torque correction.
    """
    gw_k = gw_lbs / 1000.0
    W1 = max(14, min(22, int(gw_k)))
    W2 = min(23, W1 + 1)
    a1 = _RCDT.get(W1, 40.0)
    a2 = _RCDT.get(W2, 40.0)
    a  = a1 + (gw_k - W1) * (a2 - a1)
    return dxrc / a if a != 0 else 0.0


# ── Lazy-loaded singletons ─────────────────────────────────────────────────────

_cache: dict = {}


def load_tables(variant: str) -> tuple:
    """
    Return (torque_tbl, ff_tbl, pa_tbl, oge_tbl) for the requested variant.

    torque_tbl : LBTorqueTable  (LB)  or PetenTorqueTable  (peten/ALPHA).
                 LBTorqueTable also provides query_q() and query_ff().
    ff_tbl     : FFAlphaTable   (ALPHA) or None.  When None, fuel flow is
                 taken from torque_tbl.query_ff() instead (LB and peten).
    pa_tbl     : PATable — power available (% torque), engine-temperature-corrected.
    oge_tbl    : OGETable — OGE hover torque required (% torque).

    Results are cached in _cache after first load.
    """
    if variant not in _cache:
        oge     = OGETable(DATA_DIR / "oge")
        atf_pth = DATA_DIR / "atf"
        if variant == "LB":
            torque = LBTorqueTable(DATA_DIR / "cruiseLB")
            ff     = None
            pa     = PATable(DATA_DIR / "paLB",   atf_path=atf_pth, rpm_fix=0.0)
        elif variant == "ALPHA":
            torque = PetenTorqueTable(DATA_DIR / "cruise")
            ff     = FFAlphaTable(DATA_DIR / "ffALPHA")
            pa     = PATable(DATA_DIR / "paALPHA", atf_path=atf_pth, rpm_fix=0.8)
        else:   # peten (AH-64A)
            torque = PetenTorqueTable(DATA_DIR / "cruise")
            ff     = None
            pa     = PATable(DATA_DIR / "pa",      atf_path=atf_pth, rpm_fix=0.8)
        _cache[variant] = (torque, ff, pa, oge)

    return _cache[variant]
