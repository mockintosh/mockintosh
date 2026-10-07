# Maps: possible follow-ups

Ideas that came up while building Maps, not yet taken on.

## Roof shapes for 3D buildings

Every 3D building is drawn as a flat-topped box. OpenStreetMap often knows
better: its "Simple 3D Buildings" tags give a building or building part a
`roof:shape` (`dome`, `pyramidal`, `gabled`, `hipped`, `skillion`, `onion`,
`round`, …), a `roof:height`, and sometimes `roof:direction` and
`roof:orientation`. Churches, domed landmarks (the Capitol, cathedrals),
spires and towers such as the Chrysler Building's crown would read far
better with them.

**Why we can't today.** The vector tiles (OpenMapTiles, via OpenFreeMap) keep
only `render_height`, `render_min_height`, `colour` and `hide_3d` in the
`building` layer. Roof shape and roof height are dropped, so
`collectBuildings` (`perspective.ts`) has nothing to go on.

**Ways to get the data**

- Ask Overpass for the roof tags of the buildings in view: one query per
  data tile, cached like the tiles. Buildings would have to be matched by
  footprint, since OpenMapTiles drops OSM ids from the building layer. It
  also adds load on a public service.
- Use, or host, a tile schema that keeps roof tags (a custom Planetiler
  profile, say).
- Only for landmarks: a small list of well-known buildings with their roof
  shapes, fetched or bundled.

**Drawing them.** A roof becomes more surfaces between the walls' top and
`height`: a pyramid or dome on the outline, ridges for gabled and hipped
roofs. The CPU depth buffer and the GPU mesh (`gpuBuildings.ts`) both take
arbitrary flat polygons, so roofs could be built as triangles once per tile
and shaded like walls, by which way they face.

**Not available anywhere in OSM: real models.** OSM has no sculpted
meshes. The Statue of Liberty, for one, is mapped only as its pedestal's six
stacked parts (up to 46.9 m) and Fort Wood's star; the copper figure itself
(to 93 m) isn't modelled. A `3dmr=*` tag can link a model in the 3D Model
Repository (3dmr.eu), but nothing at the statue has one, and few buildings
do.
