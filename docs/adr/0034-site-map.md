# ADR 0034 — Site map in production control

- Status: Accepted (owner request 2026-11-24)

## Context
The owner asked for an overview image of the project area in production control. Logistics tasks are dragged onto the map; gates with their codes and other objects can be created on it; deviations blink red on the map when they concern an object.

Owner choices (2026-11-24):
- the tasks are logistics tasks (the same ones as in the calendar);
- one map per site;
- images and PDFs are both accepted;
- the demo data shows a fictional large project (a data centre campus).

## Decision

### Data (migration `20261125090000_site_map`)
| Table | Purpose |
|---|---|
| `site_maps` | The overview image of a site: storage key, SHA-256, size and pixel size. One active map per site (partial unique index); a new upload archives the old one. |
| `site_map_objects` | Gate, unloading point, storage, crane, lifting area, site office, parking, waste point, danger zone or other. Each has a code (e.g. "P1", unique per site among active objects, case-insensitive), a name, a position and, for an area, a size. Positions are fractions (0–1) of the image, so they survive a new image of the same plan. |
| `site_map_task_pins` | Where a logistics task is on the map, optionally at an object. |

Integrity rules:
- Composite foreign keys keep a pin's task and object, and an object's logistics location, on the same site.
- CHECK constraints keep positions on the map and areas inside it.
- Row-level security applies as for every company table (ADR 0022).

### Gates are logistics locations
- A gate, unloading point or storage created on the map is also a logistics location, named "code name", so deliveries can use it.
- An existing location can be placed on the map instead.
- Removing the object keeps the location and releases it to be placed again.

### Deviations of objects
- `logistics_deviations.request_id` is now optional, and `map_object_id` was added. A CHECK constraint requires one of the two.
- A deviation can be reported on an object from the map, e.g. a jammed gate or a crane fault. It uses the same types, photo, e-mail notification to logistics approvers, acknowledging and resolving as a task's deviation (ADR 0026, phase 3).
- **Blinking:** an object blinks red while it has an open or acknowledged deviation, or while a task pinned to it has one. Task markers with a deviation blink too. With reduced motion they are a steady red.
- The deviations list shows an object deviation as "On the map: P2 Gate 2" with a link to the map. The §27 risk facts take the object as the subject.

### Map image
- Stored through the storage adapter and served only through an authorized route.
- PNG, JPEG and WebP are checked by content.
- A PDF's first page is rendered to a JPEG in the browser with pdf.js (`pdfjs-dist`, worker as a module), so the server never parses PDFs.

### UI (`/logistics/map`, tab "Aluekartta")
- Site and day/week pickers.
- The map with objects as labelled chips or areas, and task markers in the calendar's phase colours.
- **Pointer-based dragging** (mouse and touch):
  - move an object, or resize an area from its corner;
  - drag a task from the list onto the map or onto an object.
- **On a phone:** tap a task, then the map. A new object is placed by filling in its type, code and name and then tapping the map.
- The object panel shows the gate's opening hours, the tasks at the object and its deviations, with reporting, editing and removing.

### Access
- `logistics.view` in the site's project: see the map and report deviations.
- `logistics.approve` (who manages gates and storage): upload the map, change objects and place tasks.
- External members have no access.

## Consequences
- The map is a picture without a scale: positions are relative and no distances are computed.
- One page of a PDF is used. Multi-page plans are uploaded page by page as separate maps, if needed later.
