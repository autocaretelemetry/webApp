import {
  db,
  pool,
  rentalCarsTable,
  rentalBookingsTable,
  renterProfilesTable,
} from "@workspace/db";

async function main() {
  console.log("Clearing rental tables...");
  await db.delete(rentalBookingsTable);
  await db.delete(rentalCarsTable);
  await db.delete(renterProfilesTable);

  console.log("Seeding renter profiles...");
  const renters = await db
    .insert(renterProfilesTable)
    .values([
      {
        name: "Marcus Hale",
        phone: "+234 802 201 1932",
        email: "marcus.hale@example.com",
        address: "412 Birchwood Avenue, Ikoyi, Lagos",
        dateOfBirth: "1989-04-12",
        driverLicenseNumber: "LAG-DL-2019-887743",
        driverLicenseUrl: "https://images.unsplash.com/photo-1542751371-adc38448a05e?w=600",
        idDocumentType: "national_id",
        idDocumentUrl: "https://images.unsplash.com/photo-1576091160550-2173dba999ef?w=600",
        selfieUrl: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=400",
        kycStatus: "verified",
      },
      {
        name: "Zainab Bello",
        phone: "+234 805 332 1199",
        email: "zainab.bello@example.com",
        address: "8 Adetola Crescent, Surulere, Lagos",
        dateOfBirth: "1992-09-30",
        driverLicenseNumber: "LAG-DL-2021-554211",
        driverLicenseUrl: "https://images.unsplash.com/photo-1554224155-6726b3ff858f?w=600",
        idDocumentType: "national_id",
        idDocumentUrl: "https://images.unsplash.com/photo-1568822617270-2c1579f8dfe2?w=600",
        selfieUrl: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=400",
        kycStatus: "verified",
      },
      {
        name: "Tunde Adebayo",
        phone: "+234 813 700 4422",
        email: "tunde.adebayo@example.com",
        address: "21 Garki Close, Wuse 2, Abuja",
        dateOfBirth: "1995-02-14",
        driverLicenseNumber: "ABJ-DL-2022-110055",
        driverLicenseUrl: "https://images.unsplash.com/photo-1554224154-26032ffc0d07?w=600",
        idDocumentType: "passport",
        idDocumentUrl: "https://images.unsplash.com/photo-1606293926249-ed7ce4eb9d3a?w=600",
        kycStatus: "pending",
      },
    ])
    .returning();
  const marcus = renters[0]!;
  const zainab = renters[1]!;
  const tunde = renters[2]!;

  console.log("Seeding rental cars...");
  const cars = await db
    .insert(rentalCarsTable)
    .values([
      {
        ownerKind: "platform",
        ownerName: "AutoCare Fleet",
        ownerPhone: "+234 800 222 6273",
        ownerEmail: "fleet@autocare.ng",
        brand: "Toyota",
        model: "Corolla",
        year: 2022,
        color: "Pearl White",
        plateNumber: "LAG-441-XY",
        transmission: "automatic",
        seats: 5,
        fuelType: "petrol",
        dailyRate: 22000,
        city: "Lagos",
        pickupAddress: "AutoCare Hub, Lekki Phase 1, Lagos",
        description:
          "Reliable daily driver, fuel-efficient, perfect loaner while your car is in the shop.",
        imageUrl: "https://images.unsplash.com/photo-1590510696099-1ef72d2cb7c9?w=800",
        status: "approved",
        active: true,
      },
      {
        ownerKind: "platform",
        ownerName: "AutoCare Fleet",
        ownerPhone: "+234 800 222 6273",
        ownerEmail: "fleet@autocare.ng",
        brand: "Honda",
        model: "CR-V",
        year: 2023,
        color: "Modern Steel",
        plateNumber: "ABJ-118-RT",
        transmission: "automatic",
        seats: 5,
        fuelType: "petrol",
        dailyRate: 38000,
        city: "Abuja",
        pickupAddress: "AutoCare Garage, Wuse 2, Abuja",
        description: "Spacious SUV with full insurance. Great for family trips and intercity travel.",
        imageUrl: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800",
        status: "approved",
        active: true,
      },
      {
        ownerKind: "user",
        ownerName: "Marcus Hale",
        ownerPhone: "+234 802 201 1932",
        ownerEmail: "marcus.hale@example.com",
        brand: "Ford",
        model: "Mustang",
        year: 2020,
        color: "Race Red",
        plateNumber: "LAG-707-MM",
        transmission: "automatic",
        seats: 4,
        fuelType: "petrol",
        dailyRate: 75000,
        city: "Lagos",
        pickupAddress: "412 Birchwood Avenue, Ikoyi, Lagos",
        description: "Weekend ride. Available Fri–Sun. Driver must be 25+.",
        imageUrl: "https://images.unsplash.com/photo-1584345604476-8ec5e12e42dd?w=800",
        status: "approved",
        active: true,
      },
      {
        ownerKind: "user",
        ownerName: "Adaeze Okeke",
        ownerPhone: "+234 909 514 7821",
        ownerEmail: "adaeze.okeke@example.com",
        brand: "Toyota",
        model: "Camry",
        year: 2019,
        color: "Champagne Gold",
        plateNumber: "LAG-202-AK",
        transmission: "automatic",
        seats: 5,
        fuelType: "petrol",
        dailyRate: 28000,
        city: "Lagos",
        pickupAddress: "14 Allen Avenue, Ikeja, Lagos",
        description: "Quiet, comfortable saloon. Great for airport runs.",
        imageUrl: "https://images.unsplash.com/photo-1621135802920-133df287f89c?w=800",
        status: "approved",
        active: true,
      },
      {
        ownerKind: "user",
        ownerName: "Ibrahim Sani",
        ownerPhone: "+234 705 119 0044",
        ownerEmail: "ibrahim.sani@example.com",
        brand: "Hyundai",
        model: "Tucson",
        year: 2021,
        color: "Phantom Black",
        plateNumber: "KAN-880-IS",
        transmission: "automatic",
        seats: 5,
        fuelType: "petrol",
        dailyRate: 34000,
        city: "Kano",
        pickupAddress: "Zoo Road, Kano",
        description: "Newly serviced. Long-distance trips welcomed.",
        imageUrl: "https://images.unsplash.com/photo-1568844293986-8d0400bd4745?w=800",
        status: "pending",
        active: true,
      },
    ])
    .returning();

  const corolla = cars[0]!;
  const crv = cars[1]!;
  const camry = cars[3]!;

  console.log("Seeding rental bookings...");
  const now = Date.now();
  const day = 86_400_000;
  await db.insert(rentalBookingsTable).values([
    // Completed loaner — Zainab rented the Corolla two weeks ago.
    {
      carId: corolla.id,
      renterId: zainab.id,
      renterName: zainab.name,
      renterPhone: zainab.phone,
      renterEmail: zainab.email,
      startDate: new Date(now - 5 * day),
      endDate: new Date(now - 1 * day),
      days: 4,
      dailyRate: corolla.dailyRate,
      total: corolla.dailyRate * 4,
      status: "completed",
      purpose: "general",
      ownerReviewStatus: "approved",
      ownerReviewNotes: "All documents in order.",
      ownerReviewedAt: new Date(now - 7 * day),
      contractText: "AUTOCARE VEHICLE RENTAL AGREEMENT — (signed copy archived)",
      contractGeneratedAt: new Date(now - 7 * day),
      renterSignatureName: zainab.name,
      renterSignedAt: new Date(now - 6 * day),
      ownerSignatureName: "AutoCare Fleet",
      ownerSignedAt: new Date(now - 6 * day),
      paymentMethod: "online",
      paymentStatus: "paid",
      paidAt: new Date(now - 6 * day),
      confirmedAt: new Date(now - 6 * day),
      startedAt: new Date(now - 5 * day),
      completedAt: new Date(now - 1 * day),
    },
    // Confirmed upcoming — Tunde booked the CR-V, paid online, contract signed.
    {
      carId: crv.id,
      renterId: tunde.id,
      renterName: tunde.name,
      renterPhone: tunde.phone,
      renterEmail: tunde.email,
      startDate: new Date(now + 4 * day),
      endDate: new Date(now + 9 * day),
      days: 5,
      dailyRate: crv.dailyRate,
      total: crv.dailyRate * 5,
      status: "confirmed",
      purpose: "general",
      ownerReviewStatus: "approved",
      ownerReviewedAt: new Date(now - 2 * day),
      contractText: "AUTOCARE VEHICLE RENTAL AGREEMENT — (signed copy archived)",
      contractGeneratedAt: new Date(now - 2 * day),
      renterSignatureName: tunde.name,
      renterSignedAt: new Date(now - 1 * day),
      ownerSignatureName: "AutoCare Fleet",
      ownerSignedAt: new Date(now - 1 * day),
      paymentMethod: "online",
      paymentStatus: "paid",
      paidAt: new Date(now - 1 * day),
      confirmedAt: new Date(now - 1 * day),
    },
    // Awaiting owner approval — Marcus requested the Camry from Adaeze.
    {
      carId: camry.id,
      renterId: marcus.id,
      renterName: marcus.name,
      renterPhone: marcus.phone,
      renterEmail: marcus.email,
      startDate: new Date(now + 2 * day),
      endDate: new Date(now + 5 * day),
      days: 3,
      dailyRate: camry.dailyRate,
      total: camry.dailyRate * 3,
      status: "pending_review",
      purpose: "general",
      ownerReviewStatus: "pending",
      notes: "Picking up Saturday morning for a weekend trip to Ibadan.",
    },
  ]);

  console.log("Done.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
