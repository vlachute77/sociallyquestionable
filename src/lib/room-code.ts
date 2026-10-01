const ROOM_CODE_CHARACTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateRoomCode(): string {
  let code = "SQ-";

  for (let i = 0; i < 4; i += 1) {
    const randomIndex = Math.floor(Math.random() * ROOM_CODE_CHARACTERS.length);

    code += ROOM_CODE_CHARACTERS[randomIndex];
  }

  return code;
}
