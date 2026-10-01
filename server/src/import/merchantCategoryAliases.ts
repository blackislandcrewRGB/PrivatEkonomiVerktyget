/**
 * Bank Norwegian's merchant categories come in two wordings. The XLSX export
 * and the bank sync until August 2026 use short upper-case names
 * ('PKG STORES/BEER/WINE/LIQUOR'); the bank sync since September 2026 sends
 * Visa's MCC descriptions cut at 36 characters ('Package Stores – Beer, Wine,
 * and Liq'). Where the two normalise to different keys, the Visa wording is
 * listed here in full with the short name it stands for, so both land on the
 * same mapping. Seen in the bank sync: 5921, 5499 and 5999; the others are
 * Visa's wording for the short names already in the map.
 */
export const MERCHANT_CATEGORY_ALIASES: Record<string, string> = {
  "Package Stores – Beer, Wine, and Liquor": "PKG STORES/BEER/WINE/LIQUOR", // 5921
  "Misc. Food Stores – Convenience Stores and Specialty Markets": "MISC FOOD STORES - DEFAULT", // 5499
  "Miscellaneous and Specialty Retail Stores": "MISC SPECIALTY RETAIL", // 5999
  "Furniture, Home Furnishings, and Equipment Stores, Except Appliances": "FURNITURE/EQUIP STORES", // 5712
  "Billiard and Pool Establishments": "BILLIARD/POOL ESTABLISHMENT", // 7932
  "Drug Stores and Pharmacies": "DRUG STORES PHARMACIES", // 5912
  "Computer Programming, Data Processing, and Integrated Systems Design Services": "COMPUTER PROGRAM/SYS DESIGN", // 7372
  "Cigar Stores and Stands": "CIGAR STORES/STANDS", // 5993
  "Nurseries and Lawn and Garden Supply Stores": "NURSERIES, LAWN/GARDEN SUPPLY", // 5261
  "Financial Institutions – Merchandise, Services, and Debt Repayment": "FINANCIAL INST/MERCHANDISE", // 6012
  "Business Services (Not Elsewhere Classified)": "BUSINESS SERVICES - DEFAULT", // 7399
  "Service Stations (with or without Ancillary Services)": "SERVICE STATIONS", // 5541
  "Drinking Places (Alcoholic Beverages) – Bars, Taverns, Nightclubs, Cocktail Lounges, and Discotheques": "BARS/TAVERNS/LOUNGES/DISCOS", // 5813
  "Government Services (Not Elsewhere Classified)": "GOV'T SERV - DEFAULT", // 9399
  "Automobile Parking Lots and Garages": "PARKING LOTS GARAGES", // 7523
  "Parking Lots, Parking Meters and Garages": "PARKING LOTS GARAGES", // 7523, newer wording
};
