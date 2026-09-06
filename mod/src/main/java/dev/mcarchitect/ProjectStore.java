package dev.mcarchitect;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;
import java.util.zip.GZIPInputStream;
import java.util.zip.GZIPOutputStream;

/** Disk-only project storage. Called by one I/O worker, never by the tick loop. */
final class ProjectStore {
    static final Gson JSON = new GsonBuilder().disableHtmlEscaping().create();
    final Path root;
    ProjectStore(Path root) { this.root = root; }

    record Header(String projectId, String worldId, String dimension, String planId, int sectionCount) {}
    record Progress(String status, int cursor, long changedBlocks, String error) {}
    record Section(int x, int y, int z, List<String> palette, int[] runs, String statePolicy, Expected expected) {
        Section(int x, int y, int z, List<String> palette, int[] runs) { this(x, y, z, palette, runs, null, null); }
        int[] decode() {
            if (statePolicy != null && !Set.of("exact", "redstone").contains(statePolicy)) throw new IllegalArgumentException("Invalid state policy");
            if (expected != null) new Section(x, y, z, expected.palette, expected.runs).decode();
            if (x < -1_875_000 || x >= 1_875_000 || z < -1_875_000 || z >= 1_875_000
                    || y < -2048 || y > 2047) throw new IllegalArgumentException("Invalid section coordinates");
            if (palette == null || palette.isEmpty() || palette.size() > 4097 || palette.getFirst() != null
                    || runs == null || runs.length == 0 || runs.length > 8192 || runs.length % 2 != 0) {
                throw new IllegalArgumentException("Invalid section palette or RLE");
            }
            for (int i = 1; i < palette.size(); i++) {
                if (palette.get(i) == null || palette.get(i).length() > 300) throw new IllegalArgumentException("Invalid block state");
            }
            int[] result = new int[4096];
            int offset = 0;
            for (int i = 0; i < runs.length; i += 2) {
                int id = runs[i], length = runs[i + 1];
                if (id < 0 || id >= palette.size() || length < 1 || length > 4096 - offset) {
                    throw new IllegalArgumentException("Invalid section run");
                }
                Arrays.fill(result, offset, offset + length, id);
                offset += length;
            }
            if (offset != 4096) throw new IllegalArgumentException("Section must decode to exactly 4096 cells");
            return result;
        }
        String key() { return x + "," + y + "," + z; }
    }
    record Expected(List<String> palette, int[] runs) {}
    record Cell(int index, String before, String after) {}
    record Journal(String sectionHash, List<Cell> cells) {}
    record Loaded(Section section, Journal journal, String hash) {}

    Path directory(String id) {
        if (id == null || !id.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("planId must be a SHA-256 digest");
        return root.resolve(id);
    }
    Path sectionFile(String id, int index) { return directory(id).resolve("sections").resolve(String.format(Locale.ROOT, "%08d.json", index)); }
    Path journalFile(String id, int index) { return directory(id).resolve("journal").resolve(String.format(Locale.ROOT, "%08d.json.gz", index)); }

    Header open(Header header) throws IOException {
        directory(header.planId);
        if (header.projectId == null || !header.projectId.matches("[A-Za-z0-9._-]{1,120}")
                || header.worldId == null || !header.worldId.matches("[A-Za-z0-9._-]{1,200}")
                || header.dimension == null || !header.dimension.matches("[a-z0-9_.-]+:[a-z0-9_./-]+")
                || header.sectionCount < 1 || header.sectionCount > 1_000_000) {
            throw new IllegalArgumentException("Invalid project identity or section count");
        }
        Path path = directory(header.planId).resolve("manifest.json");
        if (Files.exists(path)) {
            if (!readHeader(header.planId).equals(header)) throw new IllegalArgumentException("Immutable project header differs");
        } else {
            atomicWrite(path, JSON.toJson(header).getBytes(StandardCharsets.UTF_8));
            progress(header.planId, new Progress("uploading", 0, 0, null));
        }
        return header;
    }
    Header readHeader(String id) throws IOException {
        return JSON.fromJson(Files.readString(directory(id).resolve("manifest.json")), Header.class);
    }
    Progress readProgress(String id) throws IOException {
        Path path = directory(id).resolve("progress.json");
        return Files.exists(path) ? JSON.fromJson(Files.readString(path), Progress.class) : new Progress("uploading", 0, 0, null);
    }
    void progress(String id, Progress progress) throws IOException {
        atomicWrite(directory(id).resolve("progress.json"), JSON.toJson(progress).getBytes(StandardCharsets.UTF_8));
    }
    void upload(String id, int index, String data) throws IOException {
        Header header = readHeader(id);
        if (index < 0 || index >= header.sectionCount || data == null || data.length() > 200_000) {
            throw new IllegalArgumentException("Invalid section index or size");
        }
        Section section = JSON.fromJson(data, Section.class);
        section.decode();
        Path path = sectionFile(id, index);
        if (Files.exists(path)) {
            if (!Files.readString(path).equals(data)) throw new IllegalArgumentException("Immutable section differs; create a new plan");
            return;
        }
        if (Files.exists(directory(id).resolve("sealed"))) throw new IllegalArgumentException("Project is sealed");
        atomicWrite(path, data.getBytes(StandardCharsets.UTF_8));
    }
    Header seal(String id) throws IOException {
        Header header = readHeader(id);
        MessageDigest digest = newDigest();
        digest.update((JSON.toJson(List.of(header.projectId, header.worldId, header.dimension)) + "\n").getBytes(StandardCharsets.UTF_8));
        Set<String> coordinates = new HashSet<>();
        for (int i = 0; i < header.sectionCount; i++) {
            String data = Files.readString(sectionFile(id, i));
            Section section = JSON.fromJson(data, Section.class);
            section.decode();
            if (!coordinates.add(section.key())) throw new IllegalArgumentException("Duplicate section coordinate: " + section.key());
            if (i > 0) digest.update((byte) '\n');
            digest.update(hash(data).getBytes(StandardCharsets.UTF_8));
        }
        if (!HexFormat.of().formatHex(digest.digest()).equals(id)) throw new IllegalArgumentException("Project content digest mismatch");
        atomicWrite(directory(id).resolve("sealed"), new byte[] { 1 });
        return header;
    }
    Loaded load(String id, int index) throws IOException {
        String data = Files.readString(sectionFile(id, index));
        Section section = JSON.fromJson(data, Section.class);
        section.decode();
        String hash = hash(data);
        Journal journal = null;
        Path path = journalFile(id, index);
        if (Files.exists(path)) {
            try (var input = new GZIPInputStream(Files.newInputStream(path))) {
                journal = JSON.fromJson(new String(input.readAllBytes(), StandardCharsets.UTF_8), Journal.class);
            }
            if (!hash.equals(journal.sectionHash) || journal.cells == null || journal.cells.size() > 4096) {
                throw new IllegalArgumentException("Journal does not match section " + index);
            }
            Set<Integer> seen = new HashSet<>();
            for (Cell cell : journal.cells) {
                if (cell.index < 0 || cell.index >= 4096 || !seen.add(cell.index) || cell.before == null || cell.after == null) {
                    throw new IllegalArgumentException("Invalid journal cell");
                }
            }
        }
        return new Loaded(section, journal, hash);
    }
    void journal(String id, int index, Journal journal) throws IOException {
        Path path = journalFile(id, index);
        if (Files.exists(path)) throw new IOException("Refusing to replace an existing before-image");
        var bytes = new java.io.ByteArrayOutputStream();
        try (var output = new GZIPOutputStream(bytes)) { output.write(JSON.toJson(journal).getBytes(StandardCharsets.UTF_8)); }
        atomicWrite(path, bytes.toByteArray());
    }
    List<Map<String, Object>> list() throws IOException {
        if (!Files.isDirectory(root)) return List.of();
        try (var paths = Files.list(root)) {
            var result = new ArrayList<Map<String, Object>>();
            for (Path path : paths.sorted().toList()) {
                if (!path.getFileName().toString().matches("[a-f0-9]{64}")) continue;
                String id = path.getFileName().toString();
                var item = new LinkedHashMap<String, Object>();
                try {
                    item.put("header", readHeader(id)); item.put("checkpoint", readProgress(id));
                } catch (Exception exception) {
                    item.put("planId", id); item.put("storageError", exception.toString());
                }
                item.put("requiresExplicitResume", true);
                result.add(item);
            }
            return result;
        }
    }
    static String hash(String text) { return HexFormat.of().formatHex(newDigest().digest(text.getBytes(StandardCharsets.UTF_8))); }
    static MessageDigest newDigest() {
        try { return MessageDigest.getInstance("SHA-256"); }
        catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }
    static void atomicWrite(Path path, byte[] bytes) throws IOException {
        Files.createDirectories(path.getParent());
        Path temporary = path.resolveSibling(path.getFileName() + ".tmp");
        try (FileChannel channel = FileChannel.open(temporary, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING, StandardOpenOption.WRITE)) {
            ByteBuffer buffer = ByteBuffer.wrap(bytes);
            while (buffer.hasRemaining()) channel.write(buffer);
            channel.force(true);
        }
        Files.move(temporary, path, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }
}
