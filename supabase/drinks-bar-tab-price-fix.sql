-- Bar Tab menu price is €20.00; PintDrop adds a 15% customer fee at checkout.
UPDATE public.drinks
SET price = 20.00
WHERE slug = 'tab'
  AND pub_id = 1;
