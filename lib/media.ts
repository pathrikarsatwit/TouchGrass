import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { getSupabaseClient } from "@/lib/auth";

export async function pickAndUploadQuestPhoto(hangoutId: string, userId: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Private photo sharing requires a configured Supabase project.");
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) throw new Error("Allow photo access when you choose to attach optional quest proof.");
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    quality: 0.8,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  const contentType = asset.mimeType === "image/png" ? "image/png" : "image/jpeg";
  const extension = contentType === "image/png" ? "png" : "jpg";
  const path = `${hangoutId}/${userId}/${Crypto.randomUUID()}.${extension}`;
  const response = await fetch(asset.uri);
  if (!response.ok) throw new Error("Could not read the selected photo.");
  const blob = await response.blob();
  const { error } = await client.storage.from("hangout-media").upload(path, blob, {
    contentType,
    upsert: false,
    cacheControl: "3600",
  });
  if (error) throw new Error(`Private photo upload failed: ${error.message}`);
  return { path, localUri: asset.uri };
}

export async function loadPrivatePhotoUrl(path: string) {
  const client = getSupabaseClient();
  if (!client) throw new Error("Private photo sharing requires a configured Supabase project.");
  const { data, error } = await client.storage.from("hangout-media").createSignedUrl(path, 3600);
  if (error) throw new Error(`Could not load this private photo: ${error.message}`);
  return data.signedUrl;
}
