/** @jsxRuntime automatic @jsxImportSource react */

import { Link, Section, Text } from "react-email";

import { styles } from "./styles";

export function Footer() {
  return (
    <Section style={{ textAlign: "center" }}>
      <Text>
        <Link style={styles.link} href="https://www.messangi.com">
          Home Page
        </Link>{" "}
        ・{" "}
        <Link style={styles.link} href="mailto:support@messangi.com">
          Contact Support
        </Link>
      </Text>

      <Text>Messangi ・ 5798 SW 68th St #5, South Miami, FL 33143</Text>
    </Section>
  );
}
