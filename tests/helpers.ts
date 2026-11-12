import { prisma } from "@/lib/prisma";

export async function resetDatabase() {
  await prisma.movieFact.deleteMany();
  await prisma.user.deleteMany();
}

let userCount = 0;

export function createUser(favoriteMovie: string | null) {
  userCount += 1;
  return prisma.user.create({
    data: { email: `user${userCount}@example.com`, name: `User ${userCount}`, favoriteMovie },
  });
}

export function createFact(userId: string, movie: string, createdAt: Date, content = "An older fact") {
  return prisma.movieFact.create({ data: { userId, movie, content, createdAt } });
}
