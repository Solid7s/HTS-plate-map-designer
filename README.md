# HTS-plate-map-designer

A screening plate planner for 96-well (8 × 12) and 384-well (16 × 24) plates. ChatGPT Sites hosting is authorized; preserve owner-private access. Local development and production servers bind to 127.0.0.1.

## Run locally

Requires Node.js 22.13 or newer.

```sh
npm install
npm run dev
```

Open the localhost URL printed by the server. To use a specific port:

```sh
npm run dev -- --hostname 127.0.0.1 --port 5178
```

## Design a screen

### Simplified version

Open `/simple`, or select **Simple mode** in the detailed designer. Enter five counts: cell lines, density levels per cell line, compounds, concentration levels per compound, and replicates (1–6). Density and concentration default to one level. Choose 96- or 384-well plates, optionally exclude the perimeter, then select **Generate maps**.

The simplified planner groups by compound: each plate contains one test compound and as many complete cell line/density groups as the layout permits. Each cell line/density has its own positive and negative control replicate sets on every plate where it appears. Controls are shared across concentration levels on that plate. A dose series stays with its controls on one plate when it fits; an oversized series continues on another plate with fresh controls. Replicate sets are never split. Controls are on by default and can be disabled with the checkbox. PC and NC are placeholders; the user defines their treatment and concentration outside this count-only planner.

The page compares compact square replicate sets, one-well-wide row rectangles, and their transposed column rectangles. Each layout has a compound selector, navigation through that compound's plate batches, well inspection, selected-plate and overall coverage, and a CSV export containing all its plates. Cell positions repeat across compounds. Color by cell line, compound, density level, or concentration level; PC and NC always have distinct control colors. Every combination receives the requested replicate count. Counts are saved separately on this device; the detailed designer's saved experiments remain intact. Changing inputs marks the displayed results as outdated and disables export until maps are regenerated.

Select **Try 20 cells × 40 compounds** to load the large-screen example: one density, one concentration, triplicates, positive and negative controls, and 384-well plates. It has 800 drug conditions, 2,400 drug wells, and 4,800 control wells. All 20 cell lines and their controls fit on one 384-well plate per compound (180 occupied wells), totaling 40 plates, with or without edge exclusion. On 96-well plates with edges included, row and square solutions use 120 plates, while column rectangles use 80; with edges excluded, all three use 160. The page compares plate counts across both formats using the current inputs and exclusions. Control counts can differ between solutions for oversized dose series, so total assigned wells and controls are reported per layout.

The simplified planner uses numbered level labels, not physical seeding densities or concentrations. Its CSV headers explicitly say “Density level” and “Concentration level,” and units are blank. Control concentration fields are blank, roles are `positive`/`negative`, and the final columns identify the plate's test compound and batch. Use the detailed designer for actual values, custom names, and vehicle controls. Counts are limited to 30 cell lines, 30 density levels, 50 compounds, 30 concentration levels, and 20,000 assigned wells including repeated controls. Small screens may yield identical candidate arrangements.

### Detailed version

- New cell lines start with one density: 2500 cells per well. Enter comma-separated values to add more.
- New compounds start with one concentration: 1 in the selected unit (µM initially). Enter comma-separated values to add more. One concentration unit applies to the experiment.
- Select 1–6 replicates, including duplicates and triplicates.
- Compare compact near-square blocks, row rectangles, and column rectangles. Opening the detailed designer or loading the example starts with row rectangles and an actual block width of 1 well. On startup, saved experiment inputs are restored but the width resets to 1. Drag the slider to reshape rectangular solutions; column rectangles use the same value as their height in rows. Compact squares are explicitly labeled “Auto” and size their blocks automatically. Imported project files retain their chosen width. The simplified planner also uses a 1-well default for rectangular layouts.
- Optionally exclude the outer perimeter and add vehicle controls for each cell line/density pair.
- Inspect a well, switch between compound/cell/density colors, or view the well list.
- Navigate automatically generated plates when a design exceeds a single plate.
- Export a CSV containing every position across all plates, including empty and excluded wells.
- Save/import experiment JSON files. Valid settings also autosave in the current browser's local storage.

The example cell names, densities, and concentrations are placeholders. Every cell line × density × compound × concentration is included; this version does not select only a subset of pairs. All conditions share the replicate count. Vehicle controls use the same replicate count once per cell line/density pair, independent of compound count.

## Detailed layout behavior

Each block contains one cell line, density, and compound's dose series. Doses retain input order; replicate wells follow each dose. Compact blocks use a near-square footprint. Row rectangles use the selected width. Column rectangles run the same arrangement on swapped axes, transposing each block and its well order so the pattern fills down before moving across. The same slider value becomes the block height, limited to the available rows. Because plates are rectangular, placement reflows at the physical plate edges rather than creating well addresses outside the plate. Incomplete final rows (or columns in a transposed layout) remain empty to preserve the rectangular footprint. Large groups split into blocks with whole replicate sets, then continue onto additional plates.

The first block for a cell line uses the first available position. Further blocks prefer a compact footprint around that cell line’s existing blocks, so overflow at the right side continues underneath on the right when space allows. When a cell line continues onto another plate, it prefers the same horizontal region for row layouts, or the same vertical region for column layouts. Available space and block shape can still require a different position; grouping is a preference, not a reserved region. Another plate is created when no existing plate can fit the next block. It supplies three deterministic candidate arrangements, not a globally optimal packing. There is no randomization or positional-bias correction. Designs are limited to 20,000 assigned wells, 30 cell lines, 50 compounds, and 30 numeric values per item to keep interaction responsive.

Usable well coverage is assigned sample and vehicle-control wells divided by usable wells, multiplied by 100. The large percentage and bar refer to the selected plate; the smaller “All plates” line reports the entire layout. Both show their numerator and denominator. Excluding the perimeter leaves 60 usable wells on a 96-well plate or 308 on a 384-well plate. Empty spaces reserved to preserve block shape count as unfilled usable wells. Percentages use up to one decimal place, with nearly full overall results shown as >99.9% rather than rounding to a misleading 100%. Invalid designs show no percentage.

The CSV contains experiment, layout, plate, well address, role, cell line, cells per well, compound code/name, concentration/unit, replicate, and condition ID. Compound codes are D1, D2, etc.; vehicle controls are VC. Formula-like text cells are escaped for spreadsheet safety.

## Validation

```sh
npm test
npm run typecheck
npm run build
```

Planner tests audit assignment completeness, replicate uniqueness, edge exclusion, multi-plate overflow, input validation, slider effects, and CSV output. Browser verification artifacts from development are stored in the ignored `work/` directory.

## Structure

- `app/page.tsx`: interactive workspace and browser storage/export.
- `app/globals.css`: responsive visual styling.
- `lib/planner.ts`: pure layout engine, validation, and CSV serialization.
- `lib/compound-planner.ts`: compound-focused plate allocation with matched controls and complete replicate sets.
- `lib/simple-planner.ts`: count-based setup validation, candidate generation, and plate-format comparisons.
- `tests/planner.test.mjs`: assignment correctness tests.
- `AGENTS.md`: hosting authorization and local development instructions.

Built with React and Vinext. Planning happens in your browser. Saved experiments are stored per browser and website origin; downloaded JSON provides portable persistence. Localhost storage does not automatically transfer to the hosted site. The Sites deployment uses a Cloudflare Worker; no connected apps or database are required.

## ChatGPT Sites

The project identity is stored in `.openai/hosting.json`. Build and publish through the Sites source workflow, preserving the current private audience.
