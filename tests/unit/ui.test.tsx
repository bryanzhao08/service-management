import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { StatusChip } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

describe("Button", () => {
  it("defaults to type=button so it cannot accidentally submit a form", () => {
    render(<Button>Save</Button>);
    expect(screen.getByRole("button", { name: "Save" })).toHaveAttribute(
      "type",
      "button",
    );
  });

  it("blocks clicks while busy", async () => {
    const onClick = vi.fn();
    render(
      <Button busy onClick={onClick}>
        Submitting
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Submitting" });
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps the label in the accessibility tree while busy", () => {
    // The spinner replaces the label visually, not semantically: a screen
    // reader user still needs to know which button is working.
    render(<Button busy>End shift</Button>);
    expect(screen.getByRole("button", { name: "End shift" })).toBeInTheDocument();
  });
});

describe("IconButton", () => {
  it("names itself from the required label", () => {
    render(
      <IconButton label="Take photo">
        <svg aria-hidden="true" />
      </IconButton>,
    );
    expect(screen.getByRole("button", { name: "Take photo" })).toBeInTheDocument();
  });
});

describe("Field", () => {
  it("links the label to the control", async () => {
    render(
      <Field label="Badge number">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Badge number");
    await userEvent.type(input, "4417");
    expect(input).toHaveValue("4417");
  });

  it("points aria-describedby at ids that actually exist", () => {
    render(
      <Field label="Incident note" hint="Plain language is fine." error="Too short.">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText("Incident note");
    const ids = (input.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter(Boolean);

    expect(ids).toHaveLength(2);
    for (const id of ids) {
      expect(document.getElementById(id)).not.toBeNull();
    }
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("announces the error via a live region", () => {
    render(
      <Field label="Site" error="Pick a site.">
        <Input />
      </Field>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a site.");
  });

  it("marks required without relying on the asterisk alone", () => {
    render(
      <Field label="Site" required>
        <Input />
      </Field>,
    );
    expect(screen.getByLabelText(/Site\s*\*?\s*\(required\)/)).toBeInTheDocument();
  });
});

describe("StatusChip", () => {
  it("carries the status as text, not only as colour", () => {
    render(<StatusChip status="BOUNCED" />);
    expect(screen.getByText("Bounced")).toBeInTheDocument();
  });
});
