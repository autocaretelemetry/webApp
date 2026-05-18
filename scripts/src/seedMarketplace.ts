import { eq } from "drizzle-orm";
import {
  db,
  pool,
  vendorsTable,
  partsTable,
  ordersTable,
  orderItemsTable,
  deliveryAgentsTable,
  bookingsTable,
  mechanicsTable,
  serviceCentersTable,
  type OrderItemSnapshot,
} from "@workspace/db";

async function main() {
  console.log("Clearing marketplace tables...");
  await db.delete(orderItemsTable);
  await db.delete(ordersTable);
  await db.delete(partsTable);
  await db.delete(vendorsTable);
  await db.delete(deliveryAgentsTable);

  console.log("Ensuring service centers have city/region...");
  // Backfill in case prior seeds left these blank.
  const centerCityMap: Record<string, { city: string; region: string }> = {
    "Ironclad Motors": { city: "Lagos", region: "Lagos" },
    "Apex Auto Works": { city: "Port Harcourt", region: "Rivers" },
    "Sahara Service Garage": { city: "Abuja", region: "FCT" },
  };
  for (const [name, loc] of Object.entries(centerCityMap)) {
    await db
      .update(serviceCentersTable)
      .set({ city: loc.city, region: loc.region })
      .where(eq(serviceCentersTable.name, name));
  }

  console.log("Seeding vendors...");
  const vendors = await db
    .insert(vendorsTable)
    .values([
      {
        name: "Ironworks Parts Co.",
        bio: "Family-run OEM and aftermarket supplier with 30 years in heavy-duty drivetrain components.",
        address: "184 Adeola Odeku Street, Victoria Island",
        city: "Lagos",
        region: "Lagos",
        phone: "+234 803 555 0140",
        rating: 4.7,
        reviewsCount: 312,
      },
      {
        name: "Lekki Auto Spares",
        bio: "Quick-turn aftermarket parts distributor serving Lagos workshops since 2008.",
        address: "9 Admiralty Way, Lekki Phase 1",
        city: "Lagos",
        region: "Lagos",
        phone: "+234 802 555 1011",
        rating: 4.4,
        reviewsCount: 156,
      },
      {
        name: "Apex Performance",
        bio: "Track-tested performance parts for street and circuit. Free fitment advice with every order.",
        address: "27 Aba Road, Mile 3",
        city: "Port Harcourt",
        region: "Rivers",
        phone: "+234 805 555 0188",
        rating: 4.5,
        reviewsCount: 198,
      },
      {
        name: "Northline OEM Supply",
        bio: "Authorized distributor of original-equipment manufacturer parts for European and Japanese marques.",
        address: "910 Aminu Kano Crescent, Wuse 2",
        city: "Abuja",
        region: "FCT",
        phone: "+234 807 555 0122",
        rating: 4.8,
        reviewsCount: 421,
      },
    ])
    .returning();

  const [ironworks, lekki, apex, northline] = vendors;

  console.log("Seeding parts...");
  await db.insert(partsTable).values([
    {
      vendorId: ironworks.id,
      name: "Heavy-Duty Brake Pad Set",
      description: "Ceramic-composite front brake pads engineered for towing and stop-and-go traffic. Fade-resistant up to 800F.",
      category: "Brakes",
      brand: "IronGrip",
      sku: "IG-BP-4421",
      price: 84.5,
      stock: 42,
      compatibleBrands: ["Ford", "Chevrolet", "Ram", "GMC"],
      imageUrl: "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?w=800&q=70",
    },
    {
      vendorId: ironworks.id,
      name: "Cast-Iron Engine Mount",
      description: "Reinforced rubber-isolated motor mount for high-torque V8 platforms. Direct OEM replacement.",
      category: "Engine",
      brand: "IronGrip",
      sku: "IG-EM-2210",
      price: 138.0,
      stock: 18,
      compatibleBrands: ["Ford", "Chevrolet", "Dodge"],
      imageUrl: "https://images.unsplash.com/photo-1486006920555-c77dcf18193c?w=800&q=70",
    },
    {
      vendorId: ironworks.id,
      name: "Full-Synthetic Diesel Oil 5W-40 (5qt)",
      description: "Low-SAPS synthetic engine oil rated for HDEO and modern after-treatment systems.",
      category: "Fluids",
      brand: "IronGrip",
      sku: "IG-OIL-5W40",
      price: 39.95,
      stock: 120,
      compatibleBrands: ["Ford", "Chevrolet", "Ram", "GMC"],
      imageUrl: "https://images.unsplash.com/photo-1632823471565-1ecdf5c6da77?w=800&q=70",
    },
    {
      vendorId: ironworks.id,
      name: "Stamped-Steel Skid Plate",
      description: "10-gauge front skid plate with laser-cut access ports. Powder-coated matte black.",
      category: "Body",
      brand: "IronGrip",
      sku: "IG-SP-880",
      price: 215.0,
      stock: 7,
      compatibleBrands: ["Toyota", "Jeep"],
    },

    {
      vendorId: lekki.id,
      name: "AC Compressor Clutch Kit",
      description: "Complete AC compressor clutch assembly with pulley and coil — common Lagos-traffic wear item.",
      category: "AC",
      brand: "Lekki Auto",
      sku: "LA-ACC-330",
      price: 178.0,
      stock: 14,
      compatibleBrands: ["Toyota", "Honda", "Nissan"],
      imageUrl: "https://images.unsplash.com/photo-1605618826115-fb9e0c93f4e8?w=800&q=70",
    },
    {
      vendorId: lekki.id,
      name: "Cabin AC Blower Motor",
      description: "Resistor-matched blower motor, sealed bearings. Quiet at all fan speeds.",
      category: "AC",
      brand: "Lekki Auto",
      sku: "LA-BM-118",
      price: 92.0,
      stock: 22,
      compatibleBrands: ["Toyota", "Honda", "Hyundai"],
    },
    {
      vendorId: lekki.id,
      name: "Refrigerant R-134a (12 oz)",
      description: "Single-can AC refrigerant for top-ups. Includes low-side fitting.",
      category: "Fluids",
      brand: "Lekki Auto",
      sku: "LA-R134-12",
      price: 18.5,
      stock: 80,
      compatibleBrands: ["Toyota", "Honda", "Nissan", "Hyundai", "Kia"],
    },

    {
      vendorId: apex.id,
      name: "High-Flow Cold Air Intake",
      description: "Reusable cotton filter and mandrel-bent aluminum tube. Adds 8-12 hp on most stock platforms.",
      category: "Performance",
      brand: "Apex",
      sku: "APX-CAI-101",
      price: 289.0,
      stock: 23,
      compatibleBrands: ["Subaru", "Honda", "Volkswagen"],
      imageUrl: "https://images.unsplash.com/photo-1581092580497-e0d23cbdf1dc?w=800&q=70",
    },
    {
      vendorId: apex.id,
      name: "Adjustable Coilover Set",
      description: "32-way damping adjustable coilovers, monotube design. Track-tuned, street-friendly.",
      category: "Suspension",
      brand: "Apex",
      sku: "APX-COIL-S4",
      price: 1245.0,
      stock: 5,
      compatibleBrands: ["BMW", "Audi", "Volkswagen"],
      imageUrl: "https://images.unsplash.com/photo-1486754735734-325b5831c3ad?w=800&q=70",
    },
    {
      vendorId: apex.id,
      name: "Performance Spark Plug Set (x4)",
      description: "Iridium-tipped plugs with extended electrode life. Improved cold start and throttle response.",
      category: "Engine",
      brand: "Apex",
      sku: "APX-SP-IR4",
      price: 56.0,
      stock: 88,
      compatibleBrands: ["Subaru", "Honda", "Mazda", "Toyota"],
    },
    {
      vendorId: apex.id,
      name: "Slotted & Drilled Rotor Pair",
      description: "Cross-drilled and slotted front rotors. Improved heat dissipation, zinc-plated hubs.",
      category: "Brakes",
      brand: "Apex",
      sku: "APX-ROT-340",
      price: 198.0,
      stock: 14,
      compatibleBrands: ["BMW", "Audi", "Volkswagen"],
      imageUrl: "https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?w=800&q=70",
    },

    {
      vendorId: northline.id,
      name: "OEM Cabin Air Filter",
      description: "Activated-carbon HEPA cabin filter. Genuine equipment specification for European saloons.",
      category: "Filters",
      brand: "Northline OEM",
      sku: "NL-CAF-220",
      price: 32.5,
      stock: 95,
      compatibleBrands: ["BMW", "Mercedes-Benz", "Audi"],
    },
    {
      vendorId: northline.id,
      name: "Alternator (140A)",
      description: "Bosch-supplied 140A alternator. Direct OEM replacement with two-year warranty.",
      category: "Electrical",
      brand: "Bosch",
      sku: "NL-ALT-140",
      price: 412.0,
      stock: 9,
      compatibleBrands: ["BMW", "Mercedes-Benz", "Audi", "Volkswagen"],
      imageUrl: "https://images.unsplash.com/photo-1565043589221-1a6fd9ae45c7?w=800&q=70",
    },
    {
      vendorId: northline.id,
      name: "Timing Belt Kit with Water Pump",
      description: "Complete timing service kit: belt, tensioner, idlers, water pump, and seals.",
      category: "Engine",
      brand: "Gates",
      sku: "NL-TBK-808",
      price: 348.0,
      stock: 12,
      compatibleBrands: ["Toyota", "Honda", "Subaru"],
      imageUrl: "https://images.unsplash.com/photo-1599256871679-1eaf90e1c0c0?w=800&q=70",
    },
    {
      vendorId: northline.id,
      name: "OEM Oxygen Sensor",
      description: "Heated wideband oxygen sensor. Plug-and-play OE specification.",
      category: "Electrical",
      brand: "Denso",
      sku: "NL-O2-330",
      price: 124.0,
      stock: 31,
      compatibleBrands: ["Toyota", "Lexus", "Honda"],
    },
    {
      vendorId: northline.id,
      name: "Premium Wiper Blade Pair",
      description: "All-season silicone wiper inserts, fits most J-hook arms.",
      category: "Body",
      brand: "Northline OEM",
      sku: "NL-WB-22",
      price: 28.0,
      stock: 220,
      compatibleBrands: ["BMW", "Mercedes-Benz", "Audi", "Toyota", "Honda"],
    },
  ]);

  console.log("Seeding delivery agents...");
  await db.insert(deliveryAgentsTable).values([
    {
      name: "Ifeanyi Okafor",
      phone: "+234 802 411 0921",
      city: "Lagos",
      region: "Lagos",
      vehicleType: "Motorcycle",
      bio: "Same-day parts runner across Lagos Island and Lekki. 4+ years moving heavy spares.",
      rating: 4.8,
      completedDeliveries: 312,
    },
    {
      name: "Amaka Nwosu",
      phone: "+234 803 882 4410",
      city: "Lagos",
      region: "Lagos",
      vehicleType: "Pickup",
      bio: "Pickup-truck logistics for bulky body and suspension parts. Mainland and Island coverage.",
      rating: 4.6,
      completedDeliveries: 187,
    },
    {
      name: "Tunde Bello",
      phone: "+234 805 730 1190",
      city: "Port Harcourt",
      region: "Rivers",
      vehicleType: "Motorcycle",
      bio: "Port Harcourt local courier. Knows every workshop from D-Line to Eleme.",
      rating: 4.7,
      completedDeliveries: 221,
    },
    {
      name: "Grace Mensah",
      phone: "+234 807 220 9988",
      city: "Abuja",
      region: "FCT",
      vehicleType: "Van",
      bio: "FCT van service for OEM crates and large kits. Handles fragile electronics carefully.",
      rating: 4.9,
      completedDeliveries: 148,
    },
  ]);

  console.log("Seeding sample orders...");
  const partsRows = await db.select().from(partsTable);
  const ironworksOil = partsRows.find((p) => p.sku === "IG-OIL-5W40")!;
  const ironworksPads = partsRows.find((p) => p.sku === "IG-BP-4421")!;
  const apexPlugs = partsRows.find((p) => p.sku === "APX-SP-IR4")!;
  const northlineFilter = partsRows.find((p) => p.sku === "NL-CAF-220")!;
  const lekkiACClutch = partsRows.find((p) => p.sku === "LA-ACC-330")!;
  const lekkiR134 = partsRows.find((p) => p.sku === "LA-R134-12")!;

  type Line = { part: typeof ironworksOil; qty: number };
  async function makeOrder(args: {
    vendorId: string;
    bookingId?: string;
    mechanicId?: string;
    buyerKind: "owner" | "center";
    buyerName: string;
    buyerPhone: string;
    shippingAddress: string;
    deliveryCity?: string;
    deliveryRegion?: string;
    lines: Line[];
    status: "proposed" | "placed" | "confirmed" | "shipped" | "delivered";
    trackingCode?: string;
  }) {
    const itemsTotal = args.lines.reduce((s, l) => s + l.part.price * l.qty, 0);
    const shippingFee = itemsTotal > 200 ? 0 : 12;
    const total = +(itemsTotal + shippingFee).toFixed(2);
    const now = new Date();
    const [order] = await db
      .insert(ordersTable)
      .values({
        vendorId: args.vendorId,
        bookingId: args.bookingId ?? null,
        mechanicId: args.mechanicId ?? null,
        buyerKind: args.buyerKind,
        buyerName: args.buyerName,
        buyerPhone: args.buyerPhone,
        shippingAddress: args.shippingAddress,
        deliveryCity: args.deliveryCity ?? "",
        deliveryRegion: args.deliveryRegion ?? "",
        status: args.status,
        itemsTotal: +itemsTotal.toFixed(2),
        shippingFee,
        total,
        proposedAt: args.status === "proposed" ? now : null,
        approvedAt:
          args.status === "placed" ||
          args.status === "confirmed" ||
          args.status === "shipped" ||
          args.status === "delivered"
            ? args.bookingId
              ? now
              : null
            : null,
        confirmedAt:
          args.status === "confirmed" || args.status === "shipped" || args.status === "delivered"
            ? now
            : null,
        shippedAt:
          args.status === "shipped" || args.status === "delivered" ? now : null,
        deliveredAt: args.status === "delivered" ? now : null,
        trackingCode: args.trackingCode ?? null,
      })
      .returning();
    await db.insert(orderItemsTable).values(
      args.lines.map((l) => {
        const snapshot: OrderItemSnapshot = {
          partId: l.part.id,
          name: l.part.name,
          sku: l.part.sku,
          unitPrice: l.part.price,
          quantity: l.qty,
          imageUrl: l.part.imageUrl,
        };
        return {
          orderId: order.id,
          partId: l.part.id,
          snapshot,
          quantity: l.qty,
          unitPrice: l.part.price,
          lineTotal: +(l.part.price * l.qty).toFixed(2),
        };
      }),
    );
    return order;
  }

  await makeOrder({
    vendorId: ironworks.id,
    buyerKind: "owner",
    buyerName: "Marcus Hale",
    buyerPhone: "+234 802 201 1932",
    shippingAddress: "412 Birchwood Avenue, Ikoyi, Lagos",
    deliveryCity: "Lagos",
    deliveryRegion: "Lagos",
    lines: [
      { part: ironworksOil, qty: 2 },
      { part: ironworksPads, qty: 1 },
    ],
    status: "shipped",
    trackingCode: "IW93481200221",
  });

  await makeOrder({
    vendorId: apex.id,
    buyerKind: "center",
    buyerName: "Apex Auto Works",
    buyerPhone: "+234 805 410 9920",
    shippingAddress: "24 Old Aba Road, Port Harcourt",
    deliveryCity: "Port Harcourt",
    deliveryRegion: "Rivers",
    lines: [{ part: apexPlugs, qty: 12 }],
    status: "placed",
  });

  await makeOrder({
    vendorId: northline.id,
    buyerKind: "owner",
    buyerName: "Marcus Hale",
    buyerPhone: "+234 802 201 1932",
    shippingAddress: "412 Birchwood Avenue, Ikoyi, Lagos",
    deliveryCity: "Lagos",
    deliveryRegion: "Lagos",
    lines: [{ part: northlineFilter, qty: 1 }],
    status: "delivered",
    trackingCode: "NL77821900441",
  });

  // Mechanic-initiated proposal tied to a real booking awaiting work.
  // Pick a booking that has a mechanic assigned so the proposal has a clear sender.
  const [demoBooking] = await db
    .select({
      id: bookingsTable.id,
      mechanicId: bookingsTable.mechanicId,
      serviceCenterId: bookingsTable.serviceCenterId,
    })
    .from(bookingsTable)
    .where(eq(bookingsTable.serviceType, "ac-repair"));
  if (demoBooking && demoBooking.mechanicId) {
    const [center] = await db
      .select()
      .from(serviceCentersTable)
      .where(eq(serviceCentersTable.id, demoBooking.serviceCenterId));
    const [mech] = await db
      .select()
      .from(mechanicsTable)
      .where(eq(mechanicsTable.id, demoBooking.mechanicId));
    // Bump booking into in_progress so the "order parts for this job" flow makes sense.
    await db
      .update(bookingsTable)
      .set({ status: "in_progress" })
      .where(eq(bookingsTable.id, demoBooking.id));
    if (center && mech) {
      await makeOrder({
        vendorId: lekki.id,
        bookingId: demoBooking.id,
        mechanicId: mech.id,
        buyerKind: "owner",
        buyerName: "Marcus Hale",
        buyerPhone: "+234 802 201 1932",
        shippingAddress: center.address,
        deliveryCity: center.city,
        deliveryRegion: center.region,
        lines: [
          { part: lekkiACClutch, qty: 1 },
          { part: lekkiR134, qty: 2 },
        ],
        status: "proposed",
      });
      console.log(
        `Created proposed parts order for booking ${demoBooking.id} from ${mech.name}.`,
      );
    }
  }

  console.log("Done.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
