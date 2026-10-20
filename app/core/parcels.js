// parcels.js - real land found for sale (asking prices from listing snippets, 2026-10; NOT verified on the listing
// page, NOT closed sales). Each parcel runs through screening.bestForSite in its market, with overrides for what its
// setting and zoning imply. price_factor: share of the market's beachfront/prime $/sf a buyer pays here (E: across
// the road with a view ~0.75, inland near the resort ~0.5-0.6). Zoning limits (floors, FAR) are the stated zoning
// where reported, otherwise estimates marked in `note`.
export const PARCELS = [
  // ---- Dorado, Puerto Rico ----
  { market: 'Puerto Rico: Dorado', status: 'listed', name: 'Oceanfront residential site (Christiansen Commercial)', acres: 1.93, land: 8.7948e6, price_factor: 1.0, max_floors: 4, max_far: 1.0,
    note: 'R-I zoning: low-density walk-ups, no high-rise (R); 4 storeys E', src: 'commercialsearch.com listing, Jun 2026' },
  { market: 'Puerto Rico: Dorado', status: 'listed', name: 'Villa Dorado Estates lot 8 (in Dorado Beach Resort)', acres: 1.0, land: 6.9e6, price_factor: 1.0, max_floors: 3, max_far: 0.5,
    note: 'estate lot; multi-unit needs rezoning (E)', src: 'nestseekers.com, finditpr.com 2026' },
  { market: 'Puerto Rico: Dorado', status: 'listed', name: 'Former Rockefeller estate, opposite the Ritz-Carlton Reserve', acres: 3.8, land: 8.5e6, price_factor: 0.85, max_floors: 3, max_far: 0.6,
    note: 'listing date unknown; zoning not stated (E 3 storeys)', src: 'newsismybusiness.com' },
  { market: 'Puerto Rico: Dorado', status: 'listed', name: 'Bo. Higuillar, Carr. 695 Km 3.2 (CT-L)', acres: 6.7, land: 10e6, price_factor: 0.55, max_floors: 4, max_far: 1.0, absorption_factor: 1.5,
    note: 'CT-L light tourism commercial: boutique hotel / STR (R); inland near Dorado Beach', src: 'wrarealestate MLS PR9114368' },
  { market: 'Puerto Rico: Dorado', status: 'listed', name: 'Dorado Plantation lot near The Cottages', acres: 0.36, land: 3.2e6, price_factor: 0.8, max_floors: 3, max_far: 1.0,
    note: 'shovel-ready with renderings (R); golf-cart beach access', src: 'puertoricorealestate4sale.com' },
  { market: 'Puerto Rico: Dorado', status: 'listed', name: 'Bo. Higuillar 10 cuerdas', acres: 9.7, land: 2.35e6, price_factor: 0.5, max_floors: 4, max_far: 0.8, absorption_factor: 1.5,
    note: 'urban-development land, lots segregated (R); inland', src: 'remaxdorado.com' },
  // ---- Grand Cayman ----
  { market: 'Cayman: Seven Mile Beach', status: 'listed', name: 'Block 5C Parcel 282, Seven Mile Beach beachfront', acres: 0.6075, land: 23.9e6, price_factor: 1.0, max_floors: 10, max_far: 3,
    note: 'Hotel/Tourism (R); 10 storeys by H/T rule', src: 'paradisepropertiescayman.com MLS 418731' },
  { market: 'Cayman: Seven Mile Beach', status: 'listed', name: 'Cayman Islander parcels, West Bay Road', acres: 5.67, land: 32.5e6, price_factor: 0.75, max_floors: 10, max_far: 3,
    note: 'asking $30-35M (two sources; midpoint used); across West Bay Road, inland view (R)', src: 'cireba MLS 420808; Caribbean Journal 2026-07' },
  { market: 'Cayman: Seven Mile Beach', status: 'listed', name: 'Seven Mile Corridor Hotel/Tourism acreage', acres: 3.78, land: 26.5e6, price_factor: 0.75, max_floors: 10, max_far: 3,
    note: 'H/T up to 10 storeys (R); 350 ft on West Bay Road, beach access not stated', src: 'cireba MLS 418917' },
  { market: 'Cayman: Seven Mile Beach', status: 'listed', name: 'Boggy Sand Road beachfront, approved plans', acres: 0.28, land: 4.95e6, price_factor: 1.0, max_floors: 3, max_far: 0.8,
    note: 'residential zoning with approved plans (R); 3 storeys E', src: 'cireba' },
  { market: 'Cayman: Seven Mile Beach', status: 'listed', name: 'Near Seven Mile Beach, low-density residential', acres: 1.18, land: 6.402e6, price_factor: 0.7, max_floors: 3, max_far: 0.6,
    note: 'low-density residential (R)', src: 'leadingre.com' },
  { market: 'Cayman: Seven Mile Beach', status: 'listed', name: 'Off Esterley Tibbetts Hwy, Camana Bay side, high density', acres: 4.08, land: 3.85e6, price_factor: 0.5, max_floors: 7, max_far: 2, absorption_factor: 1.3,
    note: 'high-density zoning (R); inland lakeside', src: 'cireba' },
  { market: 'Cayman: Seven Mile Beach', status: 'listed', name: 'Esterley Tibbetts Hwy 8.09 acres', acres: 8.09, land: 6.96e6, price_factor: 0.5, max_floors: 7, max_far: 1.5, absorption_factor: 1.3,
    note: 'being subdivided (R); inland; zoning not stated (E)', src: 'remax.ky MLS 420732' },
  { market: 'Cayman: Seven Mile Beach', status: 'listed', name: 'South Sound development land 1.75 acres', acres: 1.75, land: 2.67e6, price_factor: 0.6, max_floors: 5, max_far: 1.2,
    note: 'development land; oceanfront not stated (E)', src: 'cireba MLS 419392' },
  { market: 'Cayman: Seven Mile Beach', status: 'listed', name: 'South Sound development land 7.19 acres', acres: 7.19, land: 10.7e6, price_factor: 0.6, max_floors: 5, max_far: 1.2,
    note: 'CI$7.9-9.7M asking (two figures; midpoint US$ used)', src: 'cireba MLS 418749' },

  // ---- Charlotte ----
  { market: 'Charlotte Myers Park / Eastover boutique', name: 'Edgehill Rd at Brunswick Ave, Myers Park (rezoning 2026-016)', acres: 1.88, land: 9.4e6, status: 'not for sale (owner redeveloping); land at $5M/acre E', price_factor: 1.0, max_floors: 5, max_far: 2.5,
    note: 'N2-B, petition for N2-C(CD) up to 225 stacked units (R); owner avoids 8+ storeys (R)', src: 'charmeck.org rezoning 2026-016' },
  { market: 'Charlotte Myers Park / Eastover boutique', name: '329 Rensselaer Ave, South End / Dilworth', acres: 0.34, land: 1.65e6, status: 'listed (date unknown)', price_factor: 0.9, max_floors: 5, max_far: 2.5,
    note: 'TOD-NC with historic overlay, marketed for townhomes or condos (R); must be split from parent parcel', src: 'mpvre.com' },
  { market: 'Charlotte Myers Park / Eastover boutique', name: 'E Blvd & Scott Ave, Dilworth (former Alpine Ski Center)', acres: 0.5, land: 2.55e6, status: 'sold 2025-26 (comp)', price_factor: 0.95, max_floors: 6, max_far: 3,
    note: 'bought for a 70k sf office (R); zoning not stated', src: 'thecharlotteledger.com' },
  { market: 'Charlotte Myers Park / Eastover boutique', name: '2001 Radcliffe Ave, Myers Park', acres: 0.52, land: 2.15e6, status: 'listed', price_factor: 1.0, max_floors: 3, max_far: 1.0,
    note: 'probably N1-A single-family (E): condos need rezoning', src: 'homes.com' },
  // ---- Nashville ----
  { market: 'Nashville West End / Green Hills boutique', name: '1701 21st Ave S, Hillsboro Village (Avison Young)', acres: 1.32, land: 15e6, status: 'listed 2025-11', price_factor: 1.0, max_floors: 8, max_far: 3,
    note: 'zoning not stated, likely MUL-A (E); 30k sf office plus parking, delivered vacant (R)', src: 'avisonyoung.us 2025-11-04' },
  { market: 'Nashville West End / Green Hills boutique', name: '4012 Hillsboro Pike, Green Hills', acres: 1.03, land: 13.05e6, status: 'sold ~2024 (comp)', price_factor: 1.0, max_floors: 12, max_far: 4,
    note: 'zoned for up to 15 floors (R); market cap 12 applied', src: 'nashvillepost.com' },
  { market: 'Nashville core (Gulch / SoBro / Midtown)', name: '15th Ave N & Church St, Midtown (ex-Roers site)', acres: 1.2, land: 10e6, status: 'sold ~2024-11 (comp)', price_factor: 0.95, max_floors: 20, max_far: 8,
    note: 'zoning not stated (E)', src: 'nashvillepost.com' },
  { market: 'Nashville core (Gulch / SoBro / Midtown)', name: '1020-1026 3rd Ave S, Chestnut Hill (Richland)', acres: 0.57, land: 8.1e6, status: 'sold 2025-26 (comp)', price_factor: 0.85, max_floors: 8, max_far: 5,
    note: '8-storey for-sale condo planned, setback variance granted (R)', src: 'nashvillepost.com' },
  { market: 'Nashville core (Gulch / SoBro / Midtown)', name: '319 Peabody St, SoBro (DAC)', acres: 0.96, land: 22e6, status: 'sold 2025-26 (comp)', price_factor: 1.0, max_floors: 60, max_far: 15,
    note: 'DTC, 53-storey hotel-condo tower planned (R)', src: 'connectcre.com' },
];
