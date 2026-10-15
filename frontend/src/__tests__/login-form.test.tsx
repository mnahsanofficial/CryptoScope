import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoginForm } from "@/components/login-form";
import { AuthProvider } from "@/lib/auth-context";
import { setSession } from "@/lib/session";

const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const fakeJwt = (payload: object) => `h.${btoa(JSON.stringify(payload))}.s`;

function renderForm() {
  return render(
    <AuthProvider>
      <LoginForm />
    </AuthProvider>,
  );
}

function fillAndSubmit(email: string, password: string) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

beforeEach(() => {
  replace.mockReset();
  setSession(null);
});

describe("LoginForm", () => {
  it("keeps the button disabled until both fields are filled", () => {
    renderForm();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeDisabled();
  });

  it("logs in and goes to the dashboard", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ accessToken: fakeJwt({ exp: Date.now() / 1000 + 3600 }), user: { id: "1", email: "admin@x.io", role: "admin" } }),
    }) as unknown as typeof fetch;

    renderForm();
    fillAndSubmit("admin@x.io", "a-long-password");

    await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ email: "admin@x.io", password: "a-long-password" });
  });

  it("shows the API's error message on failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({ message: "Invalid email or password" }),
    }) as unknown as typeof fetch;

    renderForm();
    fillAndSubmit("admin@x.io", "wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
    expect(replace).not.toHaveBeenCalled();
  });
});
