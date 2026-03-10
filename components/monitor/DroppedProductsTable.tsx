"use client";
import { Card, Text, IndexTable, BlockStack } from "@shopify/polaris";

type DroppedProduct = {
  title: string;
  count: number;
  pctOfDrops: number;
};

interface Props {
  products: DroppedProduct[];
}

export function DroppedProductsTable({ products }: Props) {
  return (
    <Card>
      <BlockStack gap="300">
        <Text as="h2" variant="headingMd">
          Products in Abandoned Carts
        </Text>

        {products.length === 0 ? (
          <Text as="p" tone="subdued">
            No abandoned cart data in this time range.
          </Text>
        ) : (
          <IndexTable
            resourceName={{ singular: "product", plural: "products" }}
            itemCount={products.length}
            headings={[
              { title: "Product" },
              { title: "In Dropped Carts" },
              { title: "% of Drops" },
            ]}
            selectable={false}
          >
            {products.map((p, i) => (
              <IndexTable.Row key={p.title} id={p.title} position={i}>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd">
                    {p.title}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" fontWeight="semibold">
                    {p.count}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" tone="subdued">
                    {p.pctOfDrops}%
                  </Text>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </BlockStack>
    </Card>
  );
}
