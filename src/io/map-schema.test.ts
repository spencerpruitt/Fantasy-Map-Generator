/// <reference types="node" />
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { joinMapData, type MapRecord, splitMapData } from "./map-schema";

// The committed demo world, reused as the round-trip fixture. Read as a raw
// string: the round-trip is a string-level property, so the byte encoding is
// irrelevant as long as read/split/join/compare all use the same string.
const FIXTURE_PATH = fileURLToPath(new URL("../../tests/fixtures/demo.map", import.meta.url));
const rawFixture = readFileSync(FIXTURE_PATH, "utf8");

describe("map-schema codec", () => {
  // The centerpiece: the .map contract holds iff loading then re-saving a real
  // world reproduces the original bytes exactly.
  it("join(split(raw)) === raw — byte-identical for the demo fixture", () => {
    expect(joinMapData(splitMapData(rawFixture))).toBe(rawFixture);
  });

  // Structural symmetry the other direction: a record survives a join then split
  // unchanged, so the named shape is a faithful view of the bytes.
  it("split(join(record)) deep-equals a record parsed from the fixture", () => {
    const record = splitMapData(rawFixture);
    expect(splitMapData(joinMapData(record))).toEqual(record);
  });

  it("preserves deprecated/reserved slots unchanged across a round-trip", () => {
    const record = splitMapData(rawFixture);

    // The two deprecated top-level [] slots (pack.cells.road / crossroad) are
    // kept as named reserved positions, not dropped.
    expect(record.reservedRoad).toBe("");
    expect(record.reservedCrossroad).toBe("");
    // ...and a reserved placeholder inside the settings slot survives too.
    expect(record.settings.reservedBarSize).toBe("");

    const rejoined = splitMapData(joinMapData(record));
    expect(rejoined.reservedRoad).toBe(record.reservedRoad);
    expect(rejoined.reservedCrossroad).toBe(record.reservedCrossroad);
    expect(rejoined.settings.reservedBarSize).toBe(record.settings.reservedBarSize);
  });

  it("throws when a required field is missing, rather than writing a corrupt file", () => {
    const record = splitMapData(rawFixture);
    delete (record as Partial<MapRecord>).svg;

    expect(() => joinMapData(record as MapRecord)).toThrow(/svg/);
  });
});

// Slice 2 guard: save.ts no longer hand-orders an array — it builds a named
// MapRecord and delegates layout to joinMapData. This pins the codec's byte
// layout to the exact historical positional order save.ts used to emit, so a
// future field reorder/rename in the schema (which both split and join would
// agree on, escaping the round-trip test) still fails CI. The expected string
// is the legacy `[...].join("\r\n")` layout, built here from the same samples.
describe("map-schema byte layout matches the historical .map positional order", () => {
  it("joins a fully-populated record into the legacy positional layout", () => {
    const record: MapRecord = {
      params: {
        version: "1.0",
        license: "lic",
        date: "2026-1-1",
        seed: "123",
        graphWidth: "800",
        graphHeight: "600",
        mapId: "99"
      },
      settings: {
        distanceUnit: "km",
        distanceScale: "1",
        areaUnit: "square",
        heightUnit: "m",
        heightExponent: "2",
        temperatureScale: "°C",
        reservedBarSize: "",
        reservedBarLabel: "",
        reservedBarBackColor1: "",
        reservedBarBackColor2: "",
        reservedBarPosX: "",
        reservedBarPosY: "",
        populationRate: "1000",
        urbanization: "1",
        mapSize: "20",
        latitude: "31",
        reservedTemperatureEquator: "",
        reservedTemperatureNorth: "",
        prec: "100",
        options: '{"year":1}',
        mapName: "Test",
        hideLabels: "0",
        stylePreset: "default",
        rescaleLabels: "0",
        urbanDensity: "10",
        longitude: "50",
        growthRate: "1"
      },
      coords: '{"latT":1}',
      biomes: { color: "#fff,#000", habitability: "0,100", name: "Marine,Hot desert" },
      notes: "[]",
      svg: "<svg/>",
      gridGeneral: '{"spacing":5}',
      gridCellsH: "1,2,3",
      gridCellsPrec: "4,5,6",
      gridCellsF: "7,8,9",
      gridCellsT: "1,1,1",
      gridCellsTemp: "10,11,12",
      packFeatures: "[1]",
      cultures: "[2]",
      states: "[3]",
      burgs: "[4]",
      cellsBiome: "0,1,2",
      cellsBurg: "0,0,1",
      cellsConf: "0,0,0",
      cellsCulture: "1,1,2",
      cellsFl: "0,5,0",
      cellsPop: "1.2,3.4,5.6",
      cellsR: "0,1,0",
      reservedRoad: "",
      cellsS: "0,2,0",
      cellsState: "1,1,2",
      cellsReligion: "0,1,1",
      cellsProvince: "0,0,1",
      reservedCrossroad: "",
      religions: "[5]",
      provinces: "[6]",
      namesData: [
        { name: "German", min: "5", max: "12", d: "lt", m: "0", names: "" },
        { name: "English", min: "5", max: "12", d: "", m: "0", names: "Anna,Bob" }
      ],
      rivers: "[7]",
      rulers: "Ruler: 1,2 3,4",
      fonts: "[8]",
      markers: "[9]",
      cellRoutes: "{}",
      routes: "[10]",
      zones: "[11]",
      ice: "[12]",
      cellsGood: "0,3,0",
      goods: "[13]",
      markets: "[14]",
      deals: "[15]",
      cellsMarket: "0,1,0",
      customGoodIcons: "<g/>"
    };

    const legacyLayout = [
      "1.0|lic|2026-1-1|123|800|600|99",
      'km|1|square|m|2|°C|||||||1000|1|20|31|||100|{"year":1}|Test|0|default|0|10|50|1',
      '{"latT":1}',
      "#fff,#000|0,100|Marine,Hot desert",
      "[]",
      "<svg/>",
      '{"spacing":5}',
      "1,2,3",
      "4,5,6",
      "7,8,9",
      "1,1,1",
      "10,11,12",
      "[1]",
      "[2]",
      "[3]",
      "[4]",
      "0,1,2",
      "0,0,1",
      "0,0,0",
      "1,1,2",
      "0,5,0",
      "1.2,3.4,5.6",
      "0,1,0",
      "",
      "0,2,0",
      "1,1,2",
      "0,1,1",
      "0,0,1",
      "",
      "[5]",
      "[6]",
      "German|5|12|lt|0|/English|5|12||0|Anna,Bob",
      "[7]",
      "Ruler: 1,2 3,4",
      "[8]",
      "[9]",
      "{}",
      "[10]",
      "[11]",
      "[12]",
      "0,3,0",
      "[13]",
      "[14]",
      "[15]",
      "0,1,0",
      "<g/>"
    ].join("\r\n");

    expect(joinMapData(record)).toBe(legacyLayout);
  });
});

// Slice 3 guard: load.ts now reads named fields (record.rulers) instead of raw
// positions (data[33]). This pins each named field to the exact historical
// index/sub-index load.ts used to read, so a schema reorder that desynced the
// names from the legacy positions still fails CI.
describe("map-schema named fields map to the historical load indices", () => {
  const record = splitMapData(rawFixture);
  const parts = rawFixture.split("\r\n");
  const params = parts[0].split("|");
  const settings = parts[1].split("|");
  const biomes = parts[3].split("|");

  it("maps the compound params/settings/biomes sub-fields to their legacy indices", () => {
    expect(record.params.seed).toBe(params[3]);
    expect(record.params.graphWidth).toBe(params[4]);
    expect(record.params.mapId).toBe(params[6]);

    expect(record.settings.distanceUnit).toBe(settings[0]);
    expect(record.settings.options).toBe(settings[19]);
    expect(record.settings.urbanDensity).toBe(settings[24]);
    expect(record.settings.growthRate).toBe(settings[26]);

    expect(record.biomes.color).toBe(biomes[0]);
    expect(record.biomes.name).toBe(biomes[2]);
  });

  it("maps the plain top-level fields to their legacy data[N] positions", () => {
    expect(record.coords).toBe(parts[2]);
    expect(record.notes).toBe(parts[4]);
    expect(record.svg).toBe(parts[5]);
    expect(record.cellsState).toBe(parts[25]);
    expect(record.reservedRoad).toBe(parts[23]);
    expect(record.rulers).toBe(parts[33]);
    expect(record.fonts).toBe(parts[34]);
    expect(record.ice).toBe(parts[39]);
  });

  it("maps the namesData entries to the legacy /- and |-split positions", () => {
    const firstLegacy = parts[31].split("/")[0].split("|");
    expect(record.namesData[0].name).toBe(firstLegacy[0]);
    expect(record.namesData[0].min).toBe(firstLegacy[1]);
    expect(record.namesData[0].names).toBe(firstLegacy[5]);
    expect(record.namesData).toHaveLength(parts[31].split("/").length);
  });
});
