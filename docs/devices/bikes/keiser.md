# Keiser M3i / M3 Plus

The Keiser M3i spin bike **never accepts a connection**. Its console
broadcasts its data inside Bluetooth advertisements, a few times a second.
An app reads it by scanning continuously. There is no control: resistance is
a magnetic lever, reported as a gear number.

**Recommendation: low priority.** It needs a continuous advertisement scanner, which browsers do not offer, and it gives read-only data. Support it only if a native app already scans continuously.

Source: `src/devices/m3ibike/m3ibike.cpp` (QZ). Keiser published a simulator
for this broadcast (github.com/KeiserCorp/Keiser.M3i.BLE-HCI-Simulator,
now deprecated).

## Routing (`bluetooth.cpp:831`)

Names starting `M3` (case-sensitive) whose manufacturer data parses as a
Keiser frame. In a gym with several bikes, the setting `m3i_bike_id` picks
one bike by its system ID. The default 256 means "any bike".

## Scanning

QZ cannot rely on normal discovery, which reports each device once. It runs
its own scanner:

* **Android**: a native LE scan filtered to the bike's address, low-latency
  mode, aggressive matching, every advertisement reported, no batching.
* **iOS**: a CoreBluetooth scanner that allows duplicate advertisements.
* **Timeout**: if no advertisement arrives for 5 s, QZ treats the bike as
  disconnected.

A web game needs an advertisement-scanning API, which most browsers do not
offer. Nearby bikes and Bluetooth noise cause dropouts; cadence falling to 0
mid-ride was blamed on noise (issue #507).

## Frame (manufacturer-specific data)

Some platforms include the company ID `02 01` at the start of the payload;
skip it if present. All multi-byte values are little-endian. QZ accepts 4 to
19 bytes and only major version `06`.

| offset (after optional `02 01`) | field |
|---|---|
| 0 | major version, `06` |
| 1 | minor version |
| 2 | data type (QZ's check on it always passes, so it is effectively ignored) |
| 3 | system ID, the bike's number 0..255 |
| 4..5 | cadence, 0.1 rpm |
| 6..7 | heart rate, 0.1 bpm |
| 8..9 | power, W |
| 10..11 | calories |
| 12 | elapsed minutes |
| 13 | elapsed seconds |
| 14..15 | distance ÷ 10; bit 15 set means km, clear means miles |
| 16 | gear 1..24, only when minor version ≥ `0x21` |

QZ divides cadence and heart rate by 10 after parsing. It treats the gear as
the resistance level and converts it to a Peloton-style scale for display.

## Derived values

* **Speed** is not broadcast. QZ computes it from distance change over a
  rolling window (`m3i_bike_speed_buffsize`, default 90 samples).
* **Pause**: when the console's elapsed time stops advancing for several
  frames, or frames stop arriving, QZ treats the ride as paused. While paused
  it reports speed, power and cadence as 0.
* When the console timer restarts, QZ keeps adding to its own totals.

## Field reports

* **Erratic heart rate** on the bike console was fixed in QZ by ignoring
  invalid pulse values (issue #2711). QZ only averages pulse above a validity
  threshold.
* Random drops to Zwift were traced to the second phone's link, not the bike
  (issue #4208).

## Practical recipe for a game

1. Scan continuously with duplicates allowed. Filter by name `M3` and parse
   the manufacturer data.
2. If several bikes are in range, let the rider pick one by system ID.
3. Read power, cadence ÷ 10 and gear from every frame. Treat 5 s without a
   frame as a disconnect.
4. Show grade as a suggested gear; the bike cannot be controlled.
