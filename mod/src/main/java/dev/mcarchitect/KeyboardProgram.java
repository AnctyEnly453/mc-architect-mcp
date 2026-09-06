package dev.mcarchitect;

import java.util.*;

/** Parser only; execution always belongs to the physical computer. */
final class KeyboardProgram {
    record Word(String op, int code, int value) {}
    static int number(String text) {
        String s = text.trim();
        int n;
        try { n = s.matches("(?i)0x[0-9a-f]+") ? Integer.parseInt(s.substring(2), 16) : Integer.parseInt(s); }
        catch (NumberFormatException e) { throw new IllegalArgumentException("请输入 0–255 的整数（也可用 0x 十六进制）"); }
        if (n < 0 || n > 255) throw new IllegalArgumentException("数字必须在 0–255 之间");
        return n;
    }
    static List<Word> parse(String text) {
        var result = new ArrayList<Word>();
        for (String line : text.split("[;\\r\\n]+")) {
            line = line.replaceFirst("#.*$", "").trim(); if (line.isEmpty()) continue;
            String[] tokens = line.toUpperCase(Locale.ROOT).split("\\s+");
            String op = tokens[0].equals("ADDI") ? "ADD" : tokens[0];
            int code = switch(op) { case "LDI" -> 0; case "ADD" -> 1; case "OUT" -> 2; case "HLT" -> 3; case "IN" -> 4; default -> throw new IllegalArgumentException("未知指令：" + op); };
            if (tokens.length > 2 || (tokens.length < 2 && code < 2)) throw new IllegalArgumentException(op + " 需要一个数字");
            int value = tokens.length == 2 ? number(tokens[1]) : 0;
            result.add(new Word(op, code, value));
        }
        if (result.isEmpty() || result.size() > 8) throw new IllegalArgumentException("程序需要 1–8 条指令");
        while (result.size() < 8) result.add(new Word("HLT",3,0));
        return List.copyOf(result);
    }
}
