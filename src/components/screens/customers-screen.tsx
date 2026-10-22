"use client";

import { StatusBadge } from "@/components/ui";
import type { CustomerView } from "@/lib/workspace-repository";
import { EmptyWorkspaceState, PageTitle, money } from "./shared";

export function CustomersScreen({ customers }: { customers: CustomerView[] }) {
  return (
    <>
      <PageTitle
        title="Customers"
      />
      {customers.length === 0 ? (
        <EmptyWorkspaceState
          title="No customer accounts"
          description="This workspace has no customer or revenue records. Accounts appear only after an approved data source imports them."
          actionHref="/integrations"
          actionLabel="Review integrations"
        />
      ) : (
      <section className="card table-wrap">
        <table>
          <caption className="sr-only">Customer accounts</caption>
          <thead>
            <tr>
              <th>Account</th>
              <th>Tier</th>
              <th>ARR</th>
              <th>Signals</th>
              <th>Open issues</th>
              <th>Churn risk</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <strong>{customer.name}</strong>
                  <small>
                    {customer.customerSinceKnown
                      ? `Customer since ${customer.customerSince}`
                      : "Customer since not available"}
                    {customer.origin === "demo"
                      ? " · Demo account"
                      : customer.sourceNames.length > 0
                        ? ` · Imported from ${customer.sourceNames.join(", ")}`
                        : " · Manually managed"}
                  </small>
                </td>
                <td>
                  <StatusBadge>{customer.tier}</StatusBadge>
                </td>
                <td>
                  {customer.arrSource === "unknown"
                    ? <span className="subtle">Not available</span>
                    : money(customer.arr)}
                </td>
                <td>{customer.signals}</td>
                <td>{customer.openProblems}</td>
                <td>
                  <span
                    className={`badge ${customer.churnRisk === "Elevated" ? "medium" : ""}`}
                  >
                    {customer.churnRisk}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      )}
    </>
  );
}
