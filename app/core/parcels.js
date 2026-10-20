// parcels.js - real land found for sale (asking prices from listing snippets, 2026-10; NOT verified on the listing
// page, NOT closed sales). Each parcel runs through screening.bestForSite in its market, with overrides for what its
// setting and zoning imply. price_factor: share of the market's beachfront/prime $/sf a buyer pays here (E: across
// the road with a view ~0.75, inland near the resort ~0.5-0.6). Zoning limits (floors, FAR) are the stated zoning
// where reported, otherwise estimates marked in `note`.
export const PARCELS = [
  // ---- Dorado, Puerto Rico ----
  { market: 'Puerto Rico: Dorado', name: 'Oceanfront residential site (Christiansen Commercial)', acres: 1.93, land: 8.7948e6, price_factor: 1.0, max_floors: 4, max_far: 1.0,
    note: 'R-I zoning: low-density walk-ups, no high-rise (R); 4 storeys E', src: 'commercialsearch.com listing, Jun 2026' },
  { market: 'Puerto Rico: Dorado', name: 'Villa Dorado Estates lot 8 (in Dorado Beach Resort)', acres: 1.0, land: 6.9e6, price_factor: 1.0, max_floors: 3, max_far: 0.5,
    note: 'estate lot; multi-unit needs rezoning (E)', src: 'nestseekers.com, finditpr.com 2026' },
  { market: 'Puerto Rico: Dorado', name: 'Former Rockefeller estate, opposite the Ritz-Carlton Reserve', acres: 3.8, land: 8.5e6, price_factor: 0.85, max_floors: 3, max_far: 0.6,
    note: 'listing date unknown; zoning not stated (E 3 storeys)', src: 'newsismybusiness.com' },
  { market: 'Puerto Rico: Dorado', name: 'Bo. Higuillar, Carr. 695 Km 3.2 (CT-L)', acres: 6.7, land: 10e6, price_factor: 0.55, max_floors: 4, max_far: 1.0, absorption_factor: 1.5,
    note: 'CT-L light tourism commercial: boutique hotel / STR (R); inland near Dorado Beach', src: 'wrarealestate MLS PR9114368' },
  { market: 'Puerto Rico: Dorado', name: 'Dorado Plantation lot near The Cottages', acres: 0.36, land: 3.2e6, price_factor: 0.8, max_floors: 3, max_far: 1.0,
    note: 'shovel-ready with renderings (R); golf-cart beach access', src: 'puertoricorealestate4sale.com' },
  { market: 'Puerto Rico: Dorado', name: 'Bo. Higuillar 10 cuerdas', acres: 9.7, land: 2.35e6, price_factor: 0.5, max_floors: 4, max_far: 0.8, absorption_factor: 1.5,
    note: 'urban-development land, lots segregated (R); inland', src: 'remaxdorado.com' },
  // ---- Grand Cayman ----
  { market: 'Cayman: Seven Mile Beach', name: 'Block 5C Parcel 282, Seven Mile Beach beachfront', acres: 0.6075, land: 23.9e6, price_factor: 1.0, max_floors: 10, max_far: 3,
    note: 'Hotel/Tourism (R); 10 storeys by H/T rule', src: 'paradisepropertiescayman.com MLS 418731' },
  { market: 'Cayman: Seven Mile Beach', name: 'Cayman Islander parcels, West Bay Road', acres: 5.67, land: 32.5e6, price_factor: 0.75, max_floors: 10, max_far: 3,
    note: 'asking $30-35M (two sources; midpoint used); across West Bay Road, inland view (R)', src: 'cireba MLS 420808; Caribbean Journal 2026-07' },
  { market: 'Cayman: Seven Mile Beach', name: 'Seven Mile Corridor Hotel/Tourism acreage', acres: 3.78, land: 26.5e6, price_factor: 0.75, max_floors: 10, max_far: 3,
    note: 'H/T up to 10 storeys (R); 350 ft on West Bay Road, beach access not stated', src: 'cireba MLS 418917' },
  { market: 'Cayman: Seven Mile Beach', name: 'Boggy Sand Road beachfront, approved plans', acres: 0.28, land: 4.95e6, price_factor: 1.0, max_floors: 3, max_far: 0.8,
    note: 'residential zoning with approved plans (R); 3 storeys E', src: 'cireba' },
  { market: 'Cayman: Seven Mile Beach', name: 'Near Seven Mile Beach, low-density residential', acres: 1.18, land: 6.402e6, price_factor: 0.7, max_floors: 3, max_far: 0.6,
    note: 'low-density residential (R)', src: 'leadingre.com' },
  { market: 'Cayman: Seven Mile Beach', name: 'Off Esterley Tibbetts Hwy, Camana Bay side, high density', acres: 4.08, land: 3.85e6, price_factor: 0.5, max_floors: 7, max_far: 2, absorption_factor: 1.3,
    note: 'high-density zoning (R); inland lakeside', src: 'cireba' },
  { market: 'Cayman: Seven Mile Beach', name: 'Esterley Tibbetts Hwy 8.09 acres', acres: 8.09, land: 6.96e6, price_factor: 0.5, max_floors: 7, max_far: 1.5, absorption_factor: 1.3,
    note: 'being subdivided (R); inland; zoning not stated (E)', src: 'remax.ky MLS 420732' },
  { market: 'Cayman: Seven Mile Beach', name: 'South Sound development land 1.75 acres', acres: 1.75, land: 2.67e6, price_factor: 0.6, max_floors: 5, max_far: 1.2,
    note: 'development land; oceanfront not stated (E)', src: 'cireba MLS 419392' },
  { market: 'Cayman: Seven Mile Beach', name: 'South Sound development land 7.19 acres', acres: 7.19, land: 10.7e6, price_factor: 0.6, max_floors: 5, max_far: 1.2,
    note: 'CI$7.9-9.7M asking (two figures; midpoint US$ used)', src: 'cireba MLS 418749' },
];
