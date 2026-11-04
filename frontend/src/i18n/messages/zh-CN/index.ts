// Simplified Chinese. Typed against English: a missing or extra key fails the type check.
import type { Messages } from '../en';
import { common } from './common';
import { nav } from './nav';
import { auth } from './auth';
import { dashboard } from './dashboard';
import { status } from './status';
import { errors } from './errors';
import { inbox } from './inbox';
import { dataio } from './dataio';
import { setup } from './setup';
import { approvals } from './approvals';
import { reports } from './reports';
import { scrap } from './scrap';
import { shared } from './shared';
import { rtv } from './rtv';
import { returns } from './returns';
import { fulfillment } from './fulfillment';
import { requests } from './requests';
import { putaway } from './putaway';
import { receiving } from './receiving';

export const zhCN: Messages = {
  common,
  nav,
  auth,
  dashboard,
  status,
  errors,
  receiving,
  putaway,
  requests,
  fulfillment,
  returns,
  rtv,
  shared,
  scrap,
  reports,
  approvals,
  setup,
  dataio,
  inbox,
};
