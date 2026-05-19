import {
  db,
  pool,
  rentalCarsTable,
  rentalBookingsTable,
} from "@workspace/db";

async function main() {
  console.log("Clearing rental tables...");
  await db.delete(rentalBookingsTable);
  await db.delete(rentalCarsTable);

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
        imageUrl:
          "https://images.unsplash.com/photo-1590510696099-1ef72d2cb7c9?w=800",
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
        description:
          "Spacious SUV with full insurance. Great for family trips and intercity travel.",
        imageUrl:
          "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?w=800",
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
        imageUrl:
          "https://images.unsplash.com/photo-1584345604476-8ec5e12e42dd?w=800",
        status: "approved",
        active: true,
      },
      {
        ownerKind: "user",
        ownerName: "Tunde Adekunle",
        ownerPhone: "+234 803 778 4410",
        ownerEmail: "tunde.adekunle@example.com",
        brand: "Hyundai",
        model: "Elantra",
        year: 2021,
        color: "Phantom Black",
        plateNumber: "OYO-201-KE",
        transmission: "automatic",
        seats: 5,
        fuelType: "petrol",
        dailyRate: 18000,
        city: "Ibadan",
        pickupAddress: "Bodija Estate, Ibadan",
        description: "Clean sedan, A/C works great, comfortable for long drives.",
        imageUrl:
          "https://images.unsplash.com/photo-1605559424843-9e4c228bf1c2?w=800",
        status: "pending",
        active: true,
      },
      {
        ownerKind: "user",
        ownerName: "Funke Adeyemi",
        ownerPhone: "+234 806 991 3320",
        ownerEmail: "funke.adeyemi@example.com",
        brand: "Kia",
        model: "Sportage",
        year: 2022,
        color: "Snow White Pearl",
        plateNumber: "LAG-553-PP",
        transmission: "automatic",
        seats: 5,
        fuelType: "petrol",
        dailyRate: 34000,
        city: "Lagos",
        pickupAddress: "12 Awolowo Road, Ikoyi, Lagos",
        description: "Compact SUV in mint condition. Min. 2-day rental.",
        imageUrl:
          "https://images.unsplash.com/photo-1494976388531-d1058494cdd8?w=800",
        status: "approved",
        active: true,
      },
    ])
    .returning();

  console.log("Seeding rental bookings...");
  const corolla = cars.find((c) => c.model === "Corolla")!;
  const crv = cars.find((c) => c.model === "CR-V")!;
  const sportage = cars.find((c) => c.model === "Sportage")!;

  const now = Date.now();
  const days = (n: number) => new Date(now + n * 24 * 60 * 60 * 1000);

  await db.insert(rentalBookingsTable).values([
    {
      carId: corolla.id,
      renterName: "Zainab Bello",
      renterPhone: "+234 805 332 1199",
      renterEmail: "zainab.bello@example.com",
      startDate: days(-5),
      endDate: days(-1),
      days: 4,
      dailyRate: corolla.dailyRate,
      total: 4 * corolla.dailyRate,
      status: "completed",
      purpose: "loaner",
      completedAt: days(-1),
      confirmedAt: days(-6),
      startedAt: days(-5),
    },
    {
      carId: crv.id,
      renterName: "Marcus Hale",
      renterPhone: "+234 802 201 1932",
      renterEmail: "marcus.hale@example.com",
      startDate: days(2),
      endDate: days(6),
      days: 4,
      dailyRate: crv.dailyRate,
      total: 4 * crv.dailyRate,
      status: "confirmed",
      purpose: "general",
      confirmedAt: days(0),
    },
    {
      carId: sportage.id,
      renterName: "Chinedu Okeke",
      renterPhone: "+234 809 442 7710",
      renterEmail: "chinedu.okeke@example.com",
      startDate: days(-2),
      endDate: days(1),
      days: 3,
      dailyRate: sportage.dailyRate,
      total: 3 * sportage.dailyRate,
      status: "active",
      purpose: "general",
      confirmedAt: days(-3),
      startedAt: days(-2),
    },
  ]);

  console.log("Rental seed complete.");
  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end();
  process.exit(1);
});
