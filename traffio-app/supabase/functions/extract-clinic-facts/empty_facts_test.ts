import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { selectEmptyClinicFacts } from "../../../src/components/settings/aiOnboardingUtils.ts";

const fact = (key: string) => ({
    key,
    type: "short_text" as const,
});

Deno.test("selectEmptyClinicFacts ignora somente fatos ativos e preenchidos", () => {
    const result = selectEmptyClinicFacts([fact("filled"), fact("empty"), fact("inactive")], [
        { key: "filled", value: "valor", is_active: true },
        { key: "empty", value: "   ", is_active: true },
        { key: "inactive", value: "antigo", is_active: false },
    ]);
    assertEquals(result.map((item) => item.key), ["empty", "inactive"]);
});
