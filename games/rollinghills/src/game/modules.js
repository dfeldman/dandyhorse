/**
 * The few modules that refer to each other in a circle.
 *
 * The world builds in one order — terrain, then the trail across it, then the fields beside it — and each of those
 * three needs the others once it is running: terrain asks the trail where it is, the trail carves its lakes into
 * the terrain. As scripts they were globals and load order sorted it out. As modules an import would make the
 * dependency run first, which inverts that order, so the ones needed only at call time come through here instead:
 * each registers itself as it loads, and callers read it when they run.
 */
export const M = {}
